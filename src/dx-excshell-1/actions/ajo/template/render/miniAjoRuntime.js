// File: src/dx-excshell-1/actions/ajo/template/render/miniAjoRuntime.js
//
// Minimal evaluator for a small subset of AJO-style handlebars blocks.
// Goals:
//  - Support {{#each <path> as |alias|}} ... {{/each}} (WITH nesting)
//  - Inside each block, resolve un-namespaced tokens like:
//      {{{bodyCopy}}}, {{bodyCopy}}, {{{this}}}, {{{alias}}}, {{alias.html}}, etc.
//  - Do NOT attempt full Handlebars; do NOT touch {{fragment ...}} tags.
//  - Be safe: if parsing fails, leave input unchanged.
//  - Best-effort preview: if the each list can't be resolved, leave the block untouched.
//
// IMPORTANT CONTEXT SHAPE:
// renderTokens passes ctx shaped like { cf: {...}, prbProperties: {...}, styles: {...} }
// so templates can do: {{#each cf.bodyCopy}} ... {{/each}}
//
// IMPORTANT CHANGE:
// - We now PRESERVE unknown {{token}}/{{{token}}} instead of blanking them out.
//   This is critical so later stages (e.g., Liquid-let vars like {{prbYear}}) can still resolve.

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getByPath(obj, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * AJO-like coercion for "printable" values:
 * - primitives => String
 * - object with html/plaintext => favor html, then plaintext
 * - object with _path => _path
 * - arrays => join coerced elements (no separator)
 */
function coerceValue(val) {
  if (val == null) return "";

  if (Array.isArray(val)) return val.map(coerceValue).join("");

  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);

  if (typeof val === "object") {
    if (typeof val._path === "string") return val._path;
    if (val._path && typeof val._path === "object" && typeof val._path._path === "string") return val._path._path;

    if (typeof val.html === "string") return val.html;
    if (typeof val.plaintext === "string") return val.plaintext;

    try {
      return JSON.stringify(val);
    } catch {
      return "";
    }
  }

  return "";
}

/**
 * Resolve a "token path" against:
 * - alias var (if token begins with alias.)
 * - localCtx (the current each item)
 * - rootCtx (the namespace root passed from renderTokens, e.g. {cf, prbProperties, styles})
 */
function resolveTokenValue({ tokenPath, rootCtx, localCtx, aliasName, aliasObj }) {
  const p = String(tokenPath || "").trim();
  if (!p) return undefined;

  if (p === "this") return localCtx;

  if (aliasName && (p === aliasName || p.startsWith(aliasName + "."))) {
    const sub = p === aliasName ? "" : p.slice(aliasName.length + 1);
    return sub ? getByPath(aliasObj, sub) : aliasObj;
  }

  if (localCtx && typeof localCtx === "object") {
    const vLocal = getByPath(localCtx, p);
    if (vLocal !== undefined) return vLocal;

    // Convenience: in a bodyCopy loop, {{{bodyCopy}}} should print the item
    if (p === "bodyCopy") return localCtx;
  }

  return getByPath(rootCtx, p);
}

function replaceSimpleTokens(segment, { rootCtx, localCtx, aliasName, aliasObj }) {
  if (!segment || typeof segment !== "string") return segment;

  const triple = /\{\{\{\s*([a-zA-Z_][a-zA-Z0-9_$.]*)\s*\}\}\}/g;
  const dbl = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_$.]*)\s*\}\}/g;

  // IMPORTANT: preserve unknown tokens (return the original match)
  let out = segment.replace(triple, (m, tokenPath) => {
    const v = resolveTokenValue({ tokenPath, rootCtx, localCtx, aliasName, aliasObj });
    if (v === undefined) return m; // preserve for later stages (e.g., Liquid vars)
    return coerceValue(v);
  });

  out = out.replace(dbl, (m, tokenPath) => {
    const v = resolveTokenValue({ tokenPath, rootCtx, localCtx, aliasName, aliasObj });
    if (v === undefined) return m; // preserve for later stages (e.g., Liquid vars)
    return escapeHtml(coerceValue(v));
  });

  return out;
}

/**
 * Find the matching {{/each}} for an opening {{#each ...}} starting at openEnd,
 * correctly handling nested {{#each}} blocks.
 */
function findMatchingEachClose(html, openEnd) {
  const tagRe = /{{\s*(#each\b[^}]*|\/each)\s*}}/g;
  tagRe.lastIndex = openEnd;

  let depth = 1;
  while (true) {
    const m = tagRe.exec(html);
    if (!m) return null;

    const raw = m[1] || "";
    if (raw.startsWith("#each")) depth += 1;
    else if (raw === "/each") depth -= 1;

    if (depth === 0) {
      return { closeStart: m.index, closeEnd: tagRe.lastIndex };
    }
  }
}

function renderEachBlocks(html, rootCtx, depth, maxDepth) {
  if (!html || typeof html !== "string") return html;
  if (depth >= maxDepth) return html;

  const eachOpenRe = /{{\s*#each\s+([a-zA-Z0-9_$.]+)(?:\s+as\s+\|\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\|)?\s*}}/g;

  let out = "";
  let cursor = 0;

  while (true) {
    const m = eachOpenRe.exec(html);
    if (!m) break;

    const openStart = m.index;
    const openEnd = eachOpenRe.lastIndex;

    const path = m[1] || "";
    const aliasName = m[2] || null;

    const close = findMatchingEachClose(html, openEnd);
    if (!close) {
      out += html.slice(cursor);
      return out;
    }

    const { closeStart, closeEnd } = close;

    out += html.slice(cursor, openStart);

    const inner = html.slice(openEnd, closeStart);
    const listVal = getByPath(rootCtx, path);

    // Best-effort: if we can't resolve, keep original block intact
    if (listVal == null) {
      out += html.slice(openStart, closeEnd);
      cursor = closeEnd;
      eachOpenRe.lastIndex = cursor;
      continue;
    }

    const list = Array.isArray(listVal) ? listVal : [listVal];

    let renderedInner = "";
    for (const item of list) {
      // recurse first so nested loops render properly
      let innerExpanded = renderEachBlocks(inner, rootCtx, depth + 1, maxDepth);

      innerExpanded = replaceSimpleTokens(innerExpanded, {
        rootCtx,
        localCtx: item,
        aliasName,
        aliasObj: item,
      });

      renderedInner += innerExpanded;
    }

    out += renderedInner;

    cursor = closeEnd;
    eachOpenRe.lastIndex = cursor;
  }

  out += html.slice(cursor);
  return out;
}

function renderMiniAjo(htmlSegment, ctx) {
  if (!htmlSegment || typeof htmlSegment !== "string") return htmlSegment;

  const rootCtx = ctx && typeof ctx === "object" ? ctx : {};

  let out = renderEachBlocks(htmlSegment, rootCtx, 0, 8);

  // Replace any leftover simple tokens at root scope
  // (unknown tokens are preserved now)
  out = replaceSimpleTokens(out, {
    rootCtx,
    localCtx: null,
    aliasName: null,
    aliasObj: null,
  });

  return out;
}

module.exports = { renderMiniAjo };
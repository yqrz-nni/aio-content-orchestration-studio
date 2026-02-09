// File: src/dx-excshell-1/actions/ajo/template/render/miniAjoRuntime.js
//
// Minimal evaluator for a small subset of AJO-style handlebars blocks.
// Goals:
//  - Support {{#each <path> as |alias|}} ... {{/each}}
//  - Inside each block, resolve un-namespaced tokens like:
//      {{{bodyCopy}}}, {{bodyCopy}}, {{{this}}}, {{{alias}}}, {{alias.html}}, etc.
//  - Do NOT attempt full Handlebars; do NOT touch {{fragment ...}} tags.
//  - Be safe: if parsing fails, leave input unchanged.
//
// This is designed to run BEFORE namespace token replacement in renderTokens.js.

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
 * - object with html/plaintext => favor html
 * - object with _path => _path
 * - arrays => join coerced elements (no separator by default)
 */
function coerceValue(val) {
  if (val == null) return "";

  if (Array.isArray(val)) {
    // Mirror AJO-ish behavior: render each item as its "string value" and concatenate.
    // Using "" (not "\n") to avoid messing up HTML layout; templates can include their own <p>/<br/>.
    return val.map(coerceValue).join("");
  }

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
 * - rootCtx (the namespace root passed from renderTokens, e.g. cf ctx)
 *
 * Examples:
 * - "bodyCopy" -> localCtx.bodyCopy OR localCtx itself if it has no property but is a rich text object
 * - "this" -> localCtx
 * - "alias" -> aliasObj
 * - "alias.html" -> aliasObj.html
 */
function resolveTokenValue({ tokenPath, rootCtx, localCtx, aliasName, aliasObj }) {
  const p = String(tokenPath || "").trim();
  if (!p) return undefined;

  // Special handlebars-ish tokens (very small subset)
  if (p === "this") return localCtx;

  // Alias resolution
  if (aliasName && (p === aliasName || p.startsWith(aliasName + "."))) {
    const sub = p === aliasName ? "" : p.slice(aliasName.length + 1);
    return sub ? getByPath(aliasObj, sub) : aliasObj;
  }

  // Prefer local context first
  if (localCtx && typeof localCtx === "object") {
    const vLocal = getByPath(localCtx, p);
    if (vLocal !== undefined) return vLocal;

    // If token is "bodyCopy" but localCtx is itself a bodyCopy-like object, allow printing it directly.
    if (p === "bodyCopy") return localCtx;
  }

  // Fallback to root ctx (e.g. cf ctx)
  return getByPath(rootCtx, p);
}

/**
 * Replace un-namespaced tokens within a segment, using the current localCtx + alias var.
 * We intentionally do NOT match tokens with spaces/keywords like "fragment", "#each", etc.
 */
function replaceSimpleTokens(segment, { rootCtx, localCtx, aliasName, aliasObj }) {
  if (!segment || typeof segment !== "string") return segment;

  // Triple must run before double.
  const triple = /\{\{\{\s*([a-zA-Z_][a-zA-Z0-9_$.]*)\s*\}\}\}/g;
  const dbl = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_$.]*)\s*\}\}/g;

  let out = segment.replace(triple, (_m, tokenPath) => {
    const v = resolveTokenValue({ tokenPath, rootCtx, localCtx, aliasName, aliasObj });
    return coerceValue(v);
  });

  out = out.replace(dbl, (_m, tokenPath) => {
    const v = resolveTokenValue({ tokenPath, rootCtx, localCtx, aliasName, aliasObj });
    return escapeHtml(coerceValue(v));
  });

  return out;
}

/**
 * Minimal {{#each ...}} parser.
 *
 * Supported forms:
 *  - {{#each cf.bodyCopy as |thisBodyCopy|}} ... {{/each}}
 *  - {{#each cf.bodyCopy}} ... {{/each}}   (no alias)
 *
 * We only support non-nested each reliably; however we do a bounded recursion pass
 * to handle common nested cases without blowing up.
 */
function renderEachBlocks(html, rootCtx, depth, maxDepth) {
  if (!html || typeof html !== "string") return html;
  if (depth >= maxDepth) return html;

  // Match start tags like: {{#each <path> (as |alias|)?}}
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

    // Find matching close tag {{/each}} after openEnd
    const closeRe = /{{\s*\/each\s*}}/g;
    closeRe.lastIndex = openEnd;

    const closeMatch = closeRe.exec(html);
    if (!closeMatch) {
      // malformed; append rest and stop
      out += html.slice(cursor);
      return out;
    }

    const closeStart = closeMatch.index;
    const closeEnd = closeRe.lastIndex;

    // Append text before the each-block (but also allow simple token replacement at root level)
    const before = html.slice(cursor, openStart);
    out += before;

    const inner = html.slice(openEnd, closeStart);

    const listVal = getByPath(rootCtx, path);
    const list = Array.isArray(listVal) ? listVal : listVal ? [listVal] : [];

    let renderedInner = "";
    for (let i = 0; i < list.length; i++) {
      const item = list[i];

      // First, recursively expand nested each blocks inside the inner template with the same rootCtx.
      // (This keeps scope simple; the inner token replacement uses localCtx for item-level resolution.)
      let innerExpanded = renderEachBlocks(inner, rootCtx, depth + 1, maxDepth);

      // Then replace un-namespaced tokens using localCtx=item
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

/**
 * Main entry: expand each blocks, then replace any remaining simple tokens
 * against the root ctx (without localCtx).
 */
function renderMiniAjo(htmlSegment, ctx) {
  if (!htmlSegment || typeof htmlSegment !== "string") return htmlSegment;

  const rootCtx = ctx && typeof ctx === "object" ? ctx : {};

  // 1) Expand each blocks
  let out = renderEachBlocks(htmlSegment, rootCtx, 0, 3);

  // 2) Replace any leftover simple tokens (un-namespaced) at root scope
  out = replaceSimpleTokens(out, {
    rootCtx,
    localCtx: null,
    aliasName: null,
    aliasObj: null,
  });

  return out;
}

module.exports = { renderMiniAjo };
// File: src/dx-excshell-1/actions/ajo/template/render/renderTokens.js

const { renderMiniAjo } = require("./miniAjoRuntime");

/**
 * Preview sanitizer:
 * Remove *wrapper syntax* from rendered preview HTML only.
 * (Canonical AJO HTML remains untouched; this is for iframe preview output.)
 *
 * IMPORTANT:
 * - DO NOT remove generic {{ ... }} tokens; those include legitimate {{cf.*}}/{{prbProperties.*}} references.
 * - DO NOT remove large "ACR wrapped blocks" by spanning regex ranges — that can delete real HTML
 *   (especially with nested ACR markers / email table markup) and leave stray closing tags.
 *
 * We only strip:
 *   1) The ACR wrapper *comment markers themselves* (start/end), but NOT their enclosed content
 *   2) Handlebars comments ({{!-- ... --}})
 *   3) Liquid tags ({% ... %})   (NOTE: we evaluate {% let ... %} prior to stripping)
 *   4) Specific known "placeholder-only" each blocks that sometimes leak into preview HTML
 */
function stripAjoSyntax(html) {
  if (!html || typeof html !== "string") return html;

  let out = html;

  // 1) Remove ACR wrapper markers ONLY (do not remove the content between them)
  const acrMarkerRe = /{{!--[\s\S]*?\[(?:acr-start|acr-end)[^\]]*][\s\S]*?--}}/gim;
  out = out.replace(acrMarkerRe, "");

  // 2) Remove any remaining Handlebars comments: {{!-- ... --}}
  const hbCommentRe = /{{!--[\s\S]*?--}}/g;
  out = out.replace(hbCommentRe, "");

  // 3) Remove Liquid tags: {% ... %}
  const liquidTagRe = /{%\s*[\s\S]*?\s*%}/g;
  out = out.replace(liquidTagRe, "");

  // 4) Remove specific "empty each blocks" that are intended only to trigger reference collection
  out = stripKnownEmptyEachBlocks(out);

  return out;
}

/**
 * Removes specific Handlebars each-blocks when their body is effectively empty.
 * We keep this conservative:
 * - only applies to a small allowlist of known "ref placeholder" arrays
 * - only removes when the inner content is whitespace (after trimming)
 */
function stripKnownEmptyEachBlocks(html) {
  if (!html || typeof html !== "string") return html;

  const ALLOWLIST = ["refPlaceholders"];
  let out = html;

  for (const name of ALLOWLIST) {
    const re = new RegExp(
      String.raw`{{\s*#each\s+${escapeRegExp(name)}(?:\s+as\s+\|\s*[^|]+\s*\|)?\s*}}([\s\S]*?){{\s*\/each\s*}}`,
      "g"
    );

    out = out.replace(re, (_m, inner) => {
      const body = String(inner ?? "").trim();
      return body ? _m : "";
    });
  }

  return out;
}

function escapeRegExp(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
 * Coercion rules to make preview feel closer to AJO:
 * - arrays concatenate their items’ coerced values
 * - object with html/plaintext favors html/plaintext
 * - object with _path favors _path
 */
function coerceValue(val) {
  if (val == null) return "";

  if (Array.isArray(val)) {
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

function replaceNamespaceVars(segment, namespace, ctx) {
  if (!segment || !ctx) return segment;

  const triple = new RegExp(`\\{\\{\\{\\s*${namespace}\\.([a-zA-Z0-9_$.]+)\\s*\\}\\}\\}`, "g");
  const dbl = new RegExp(`\\{\\{\\s*${namespace}\\.([a-zA-Z0-9_$.]+)\\s*\\}\\}`, "g");

  let out = segment.replace(triple, (_m, path) => {
    const v = coerceValue(getByPath(ctx, path));
    return v; // raw
  });

  out = out.replace(dbl, (_m, path) => {
    const v = coerceValue(getByPath(ctx, path));
    return escapeHtml(v);
  });

  return out;
}

/* =============================================================================
 * Liquid (minimal) evaluator for `{% let var = expr %}` + `{{var}}` substitution
 * ============================================================================= */

function safeDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  const s = String(n ?? "");
  return s.length === 1 ? `0${s}` : s;
}

/**
 * Minimal subset of strftime we need for typical email date formatting.
 * Supports: %Y, %m, %d, %B, %b
 */
function formatDate(date, fmt, locale = "en-US") {
  const d = safeDate(date);
  if (!d) return "";

  const fullMonth = new Intl.DateTimeFormat(locale, { month: "long" }).format(d);
  const shortMonth = new Intl.DateTimeFormat(locale, { month: "short" }).format(d);

  return String(fmt ?? "")
    .replaceAll("%Y", String(d.getFullYear()))
    .replaceAll("%m", pad2(d.getMonth() + 1))
    .replaceAll("%d", pad2(d.getDate()))
    .replaceAll("%B", fullMonth)
    .replaceAll("%b", shortMonth);
}

/**
 * Parse a quoted string literal: "..." or '...'
 */
function parseStringLiteral(expr) {
  const s = String(expr ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return null;
}

/**
 * Evaluate a Liquid-ish expression:
 *   - "literal"
 *   - path.to.value
 *   - <expr> | date: "%Y"
 *
 * `vars` are the computed let-vars so lets can reference prior lets.
 * `ctx` is the mini root ctx: {cf, prbProperties, styles, ...un-namespaced locals...}
 */
function evalLiquidExpr(expr, { ctx, vars, locale = "en-US" }) {
  const raw = String(expr ?? "").trim();
  if (!raw) return "";

  // Split pipelines: a | date: "%Y"
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);

  let base = parts[0] || "";
  let val;

  const lit = parseStringLiteral(base);
  if (lit != null) {
    val = lit;
  } else if (base in (vars || {})) {
    val = vars[base];
  } else {
    val = getByPath(ctx, base);
  }

  // Apply filters
  for (let i = 1; i < parts.length; i++) {
    const f = parts[i];

    // date: "%Y"
    const m = f.match(/^date\s*:\s*(.+)$/i);
    if (m) {
      const fmtRaw = m[1] || "";
      const fmt = parseStringLiteral(fmtRaw) ?? String(fmtRaw).trim();
      val = formatDate(val, fmt, locale);
      continue;
    }

    // Unknown filters: ignore (best-effort)
  }

  return coerceValue(val);
}

/**
 * Evaluate all `{% let name = expr %}` blocks in-order, produce vars map.
 * Also supports: `{% assign name = expr %}` (common Liquid alias) just in case.
 */
function computeLiquidLets(html, { ctx, locale = "en-US" } = {}) {
  const out = {};
  if (!html || typeof html !== "string") return out;

  const root = ctx && typeof ctx === "object" ? ctx : {};

  // Allow both let and assign
  const re = /{%\s*(?:let|assign)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]*?)\s*%}/g;

  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    const expr = m[2];
    if (!name) continue;

    out[name] = evalLiquidExpr(expr, { ctx: root, vars: out, locale });
  }

  return out;
}

/**
 * Replace only top-level var tokens: {{var}} / {{{var}}}
 * Does not touch namespaced tokens like {{cf.foo}}.
 */
function replaceLiquidVarTokens(html, vars) {
  if (!html || typeof html !== "string") return html;
  if (!vars || typeof vars !== "object") return html;

  const keys = Object.keys(vars).filter(Boolean);
  if (!keys.length) return html;

  const keyAlt = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

  const triple = new RegExp(`\\{\\{\\{\\s*(${keyAlt})\\s*\\}\\}\\}`, "g");
  const dbl = new RegExp(`\\{\\{\\s*(${keyAlt})\\s*\\}\\}`, "g");

  let out = html.replace(triple, (_m, k) => String(vars[k] ?? ""));
  out = out.replace(dbl, (_m, k) => escapeHtml(String(vars[k] ?? "")));

  return out;
}

/**
 * Evaluate liquid lets and replace tokens, then remove the let/assign tags themselves.
 * (We leave other non-let liquid tags to later stripping.)
 */
function evaluateLiquidLetsAndReplace(html, { ctx, locale = "en-US" } = {}) {
  if (!html || typeof html !== "string") return html;

  const vars = computeLiquidLets(html, { ctx, locale });

  let out = replaceLiquidVarTokens(html, vars);

  // Remove let/assign tags now (they will also be stripped later, but this keeps output cleaner)
  out = out.replace(/{%\s*(?:let|assign)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*[\s\S]*?\s*%}/g, "");

  return out;
}

/* =============================================================================
 * Styles + binding-order render helpers
 * ============================================================================= */

/**
 * Determine a "default" context for a namespace:
 * - first hydrated binding in appearance order (by index) that has a value
 */
function pickDefaultCtxForNamespace({ namespace, aemBindingsEncountered, dataByStreamKey }) {
  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : [])
    .filter((b) => b?.result === namespace)
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  for (const b of binds) {
    const sk = `${b.index}:${b.result}`;
    const v = dataByStreamKey?.[sk];
    if (v && typeof v === "object") return v;
  }
  return null;
}

/**
 * Styles context derivation:
 */
function deriveStylesContext({ prbCtx, cfCtx }) {
  const prbStyle = prbCtx?.brandStyle && typeof prbCtx.brandStyle === "object" ? prbCtx.brandStyle : null;

  const cfOverride =
    cfCtx?.forceBrandStylingLeaveBlankToInheritContextualBrandStyle &&
    typeof cfCtx.forceBrandStylingLeaveBlankToInheritContextualBrandStyle === "object"
      ? cfCtx.forceBrandStylingLeaveBlankToInheritContextualBrandStyle
      : null;

  return cfOverride || prbStyle || null;
}

/**
 * Build the root context for the mini AJO runtime.
 *
 * CRITICAL:
 * Many templates assume the binding tag establishes an implicit "current" object,
 * and then reference fields un-namespaced (e.g. {{#each bodyCopy}}).
 *
 * So we:
 * - spread localCtx at the top-level for un-namespaced access
 * - expose it as {{this.*}} as well
 * - ALSO keep canonical namespaces { cf, prbProperties, styles } so {{#each cf.bodyCopy}} works too
 */
function buildMiniAjoRootCtx({ cfCtx, prbCtx, stylesCtx, localCtx }) {
  const local = localCtx && typeof localCtx === "object" ? localCtx : null;

  return {
    this: local || {},
    ...(local || {}),

    cf: cfCtx && typeof cfCtx === "object" ? cfCtx : {},
    prbProperties: prbCtx && typeof prbCtx === "object" ? prbCtx : {},
    styles: stylesCtx && typeof stylesCtx === "object" ? stylesCtx : {},
  };
}

function renderNamespaceByBindingOrder({
  html,
  namespace,
  bindings,
  dataByStreamKey,
  defaultCtx,
  defaultPrbCtx,
  defaultCfCtx,
}) {
  if (!html) return html;

  const binds = (Array.isArray(bindings) ? bindings : [])
    .filter((b) => b?.result === namespace && typeof b?.rawTag === "string")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  // If no binding tags for this namespace, still attempt a global replace using defaultCtx
  if (!binds.length) {
    if (!defaultCtx) return html;

    const miniRoot = buildMiniAjoRootCtx({
      cfCtx: namespace === "cf" ? defaultCtx : defaultCfCtx,
      prbCtx: namespace === "prbProperties" ? defaultCtx : defaultPrbCtx,
      stylesCtx: deriveStylesContext({
        prbCtx: namespace === "prbProperties" ? defaultCtx : defaultPrbCtx,
        cfCtx: namespace === "cf" ? defaultCtx : defaultCfCtx,
      }),
      localCtx: defaultCtx,
    });

    let maybeExpanded = renderMiniAjo(html, miniRoot);

    // ✅ NEW: evaluate liquid lets (best-effort) with the same root ctx
    maybeExpanded = evaluateLiquidLetsAndReplace(maybeExpanded, { ctx: miniRoot, locale: "en-US" });

    return replaceNamespaceVars(maybeExpanded, namespace, defaultCtx);
  }

  let cursor = 0;
  let out = "";
  let currentCtx = null;

  for (const b of binds) {
    const tag = b.rawTag;
    const tagPos = html.indexOf(tag, cursor);
    if (tagPos < 0) continue;

    let before = html.slice(cursor, tagPos);
    const effectiveCtx = currentCtx || defaultCtx;

    const miniRoot = buildMiniAjoRootCtx({
      cfCtx: namespace === "cf" ? effectiveCtx : defaultCfCtx,
      prbCtx: namespace === "prbProperties" ? effectiveCtx : defaultPrbCtx,
      stylesCtx: deriveStylesContext({
        prbCtx: namespace === "prbProperties" ? effectiveCtx : defaultPrbCtx,
        cfCtx: namespace === "cf" ? effectiveCtx : defaultCfCtx,
      }),
      localCtx: effectiveCtx,
    });

    // Expand minimal AJO blocks BEFORE namespaced replacements
    before = renderMiniAjo(before, miniRoot);

    // ✅ NEW: evaluate liquid lets inside this segment with the effective ctx
    before = evaluateLiquidLetsAndReplace(before, { ctx: miniRoot, locale: "en-US" });

    out += replaceNamespaceVars(before, namespace, effectiveCtx);

    // strip binding tag from preview output (we only needed it for ordering)
    out += "";

    cursor = tagPos + tag.length;

    const skey = `${b.index}:${b.result}`;
    const nextCtx = dataByStreamKey?.[skey] ?? null;
    currentCtx = nextCtx && typeof nextCtx === "object" ? nextCtx : currentCtx;
  }

  let tail = html.slice(cursor);

  const effectiveCtx = currentCtx || defaultCtx;
  const miniRoot = buildMiniAjoRootCtx({
    cfCtx: namespace === "cf" ? effectiveCtx : defaultCfCtx,
    prbCtx: namespace === "prbProperties" ? effectiveCtx : defaultPrbCtx,
    stylesCtx: deriveStylesContext({
      prbCtx: namespace === "prbProperties" ? effectiveCtx : defaultPrbCtx,
      cfCtx: namespace === "cf" ? effectiveCtx : defaultCfCtx,
    }),
    localCtx: effectiveCtx,
  });

  tail = renderMiniAjo(tail, miniRoot);

  // ✅ NEW: evaluate liquid lets in tail with effective ctx
  tail = evaluateLiquidLetsAndReplace(tail, { ctx: miniRoot, locale: "en-US" });

  out += replaceNamespaceVars(tail, namespace, effectiveCtx);

  return out;
}

/**
 * Replace {{styles.*}} by binding order, with default fallback.
 */
function resolveStylesByBindings({
  stitchedHtml,
  aemBindingsEncountered,
  aemPrefetchDataByStreamKey,
  defaultPrbCtx,
  defaultCfCtx,
}) {
  if (!stitchedHtml) return stitchedHtml;

  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : [])
    .filter((b) => b?.result === "prbProperties" || b?.result === "cf")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  // If no bindings at all, try a global styles replacement from defaults
  if (!binds.length) {
    const styles = deriveStylesContext({ prbCtx: defaultPrbCtx, cfCtx: defaultCfCtx });
    if (!styles) return stitchedHtml;

    const miniRoot = buildMiniAjoRootCtx({
      cfCtx: defaultCfCtx,
      prbCtx: defaultPrbCtx,
      stylesCtx: styles,
      localCtx: styles,
    });

    let maybeExpanded = renderMiniAjo(stitchedHtml, miniRoot);

    // ✅ NEW: evaluate liquid lets (best-effort) using defaults
    maybeExpanded = evaluateLiquidLetsAndReplace(maybeExpanded, { ctx: miniRoot, locale: "en-US" });

    return replaceNamespaceVars(maybeExpanded, "styles", styles);
  }

  let cursor = 0;
  let out = "";

  let currentPrb = null;
  let currentCf = null;
  let currentStyles = deriveStylesContext({ prbCtx: defaultPrbCtx, cfCtx: defaultCfCtx }) || null;

  for (const b of binds) {
    const tag = b.rawTag;
    const tagPos = stitchedHtml.indexOf(tag, cursor);
    if (tagPos < 0) continue;

    let seg = stitchedHtml.slice(cursor, tagPos);

    const miniRoot = buildMiniAjoRootCtx({
      cfCtx: currentCf || defaultCfCtx,
      prbCtx: currentPrb || defaultPrbCtx,
      stylesCtx: currentStyles,
      localCtx: currentStyles,
    });

    seg = renderMiniAjo(seg, miniRoot);

    // ✅ NEW: evaluate liquid lets in this segment with current styles root
    seg = evaluateLiquidLetsAndReplace(seg, { ctx: miniRoot, locale: "en-US" });

    out += replaceNamespaceVars(seg, "styles", currentStyles);

    // strip binding tag from preview output
    out += "";

    cursor = tagPos + tag.length;

    const streamKey = `${b.index}:${b.result}`;
    const ctx = aemPrefetchDataByStreamKey?.[streamKey] ?? null;

    if (b.result === "prbProperties" && ctx && typeof ctx === "object") currentPrb = ctx;
    if (b.result === "cf" && ctx && typeof ctx === "object") currentCf = ctx;

    currentStyles = deriveStylesContext({ prbCtx: currentPrb || defaultPrbCtx, cfCtx: currentCf || defaultCfCtx });
  }

  let tail = stitchedHtml.slice(cursor);

  const tailRoot = buildMiniAjoRootCtx({
    cfCtx: currentCf || defaultCfCtx,
    prbCtx: currentPrb || defaultPrbCtx,
    stylesCtx: currentStyles,
    localCtx: currentStyles,
  });

  tail = renderMiniAjo(tail, tailRoot);

  // ✅ NEW: evaluate liquid lets in tail
  tail = evaluateLiquidLetsAndReplace(tail, { ctx: tailRoot, locale: "en-US" });

  out += replaceNamespaceVars(tail, "styles", currentStyles);

  return out;
}

function buildRenderedHtmlBestEffort({ stitchedHtml, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
  let out = stitchedHtml;

  const defaultPrbCtx = pickDefaultCtxForNamespace({
    namespace: "prbProperties",
    aemBindingsEncountered,
    dataByStreamKey: aemPrefetchDataByStreamKey,
  });

  const defaultCfCtx = pickDefaultCtxForNamespace({
    namespace: "cf",
    aemBindingsEncountered,
    dataByStreamKey: aemPrefetchDataByStreamKey,
  });

  // styles first (derived from PRB/CF binding order)
  out = resolveStylesByBindings({
    stitchedHtml: out,
    aemBindingsEncountered,
    aemPrefetchDataByStreamKey,
    defaultPrbCtx,
    defaultCfCtx,
  });

  // then normal namespaces
  out = renderNamespaceByBindingOrder({
    html: out,
    namespace: "prbProperties",
    bindings: aemBindingsEncountered,
    dataByStreamKey: aemPrefetchDataByStreamKey,
    defaultCtx: defaultPrbCtx,
    defaultPrbCtx,
    defaultCfCtx,
  });

  out = renderNamespaceByBindingOrder({
    html: out,
    namespace: "cf",
    bindings: aemBindingsEncountered,
    dataByStreamKey: aemPrefetchDataByStreamKey,
    defaultCtx: defaultCfCtx,
    defaultPrbCtx,
    defaultCfCtx,
  });

  // ✅ NEW: final global liquid let evaluation using defaults (catches footer/global blocks)
  {
    const miniRoot = buildMiniAjoRootCtx({
      cfCtx: defaultCfCtx,
      prbCtx: defaultPrbCtx,
      stylesCtx: deriveStylesContext({ prbCtx: defaultPrbCtx, cfCtx: defaultCfCtx }),
      localCtx: null,
    });

    out = evaluateLiquidLetsAndReplace(out, { ctx: miniRoot, locale: "en-US" });
  }

  // final sanitize for preview HTML
  return stripAjoSyntax(out);
}

module.exports = {
  stripAjoSyntax,
  buildRenderedHtmlBestEffort,

  // exported for potential tests / reuse
  replaceNamespaceVars,
  renderNamespaceByBindingOrder,
  resolveStylesByBindings,
  pickDefaultCtxForNamespace,
  deriveStylesContext,
  stripKnownEmptyEachBlocks,

  // optional exports (handy for unit tests)
  evaluateLiquidLetsAndReplace,
  computeLiquidLets,
  evalLiquidExpr,
};
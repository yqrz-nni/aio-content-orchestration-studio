// File: src/dx-excshell-1/actions/ajo/template/render/renderTokens.js

const { renderMiniAjo } = require("./miniAjoRuntime");

/* =============================================================================
 * Diagnostics helpers (non-breaking: caller may pass an object to populate)
 * ============================================================================= */

function nowMs() {
  return Date.now();
}

function ensureDiagnostics(d) {
  if (!d || typeof d !== "object") return null;
  if (!d.preview) d.preview = {};
  if (!d.preview.renderTokens) d.preview.renderTokens = {};
  const rt = d.preview.renderTokens;

  if (!rt.timings) rt.timings = {};
  if (!rt.counts) rt.counts = {};
  if (!rt.liquid) rt.liquid = {};
  if (!rt.unresolved) rt.unresolved = {};
  if (!rt.warnings) rt.warnings = [];
  if (!rt.errors) rt.errors = [];

  // convenience counters
  if (!rt.liquid.unknownFns) rt.liquid.unknownFns = {};
  if (!rt.liquid.evaluatedLets) rt.liquid.evaluatedLets = [];

  return rt;
}

function diagAddWarning(rt, msg, meta) {
  if (!rt) return;
  rt.warnings.push(meta ? { message: msg, ...meta } : { message: msg });
}

function diagAddError(rt, msg, meta) {
  if (!rt) return;
  rt.errors.push(meta ? { message: msg, ...meta } : { message: msg });
}

/* =============================================================================
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
 * ============================================================================= */

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
 * Top-level token detection (Option 2 “small piece”)
 * ============================================================================= */

function collectTopLevelVarNames(html) {
  const out = new Set();
  if (!html || typeof html !== "string") return out;

  // Match {{foo}} or {{{foo}}} where foo is a simple identifier (no dots)
  const re = /\{\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}?\}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    if (!name) continue;
    // ignore known structural keywords (conservative)
    if (name === "fragment" || name === "each" || name === "if" || name === "else") continue;
    out.add(name);
  }
  return out;
}

/* =============================================================================
 * Liquid (minimal+) evaluator for `{% let var = expr %}` + `{{var}}` substitution
 *
 * Supports:
 * - let/assign
 * - string literal, number literal, ctx path, prior let-var reference
 * - tiny arithmetic: a + b, a - b
 * - function calls used in templates (subset):
 *   formatDate, concat, toString, toInt, split, head, get, replaceAll, includes, equals
 * - pipeline filter: | date: "%Y" (strftime-ish subset via formatDate())
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

function parseNumberLiteral(expr) {
  const t = String(expr ?? "").trim();
  if (!t) return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function splitArgs(raw) {
  const s = String(raw ?? "");
  const out = [];
  let cur = "";
  let depth = 0;
  let quote = null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }

    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseFnCall(expr) {
  const s = String(expr ?? "").trim();
  const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)$/);
  if (!m) return null;
  return { name: m[1], argsRaw: m[2] };
}

/**
 * Extract possible let-var references from an expression (best-effort).
 * Used to compute a dependency closure for “evaluate only what’s needed”.
 */
function extractLetRefs(expr) {
  const out = new Set();
  const s = String(expr ?? "");
  if (!s.trim()) return out;

  // Remove string literals to avoid false positives
  const noStrings = s.replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, " ");

  // Tokenize identifiers and dotted paths; pick the first segment (foo in foo.bar)
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)(?:\.[a-zA-Z0-9_]+)*\b/g;
  let m;
  while ((m = re.exec(noStrings)) !== null) {
    const id = m[1];
    if (!id) continue;
    // ignore common function names / keywords (conservative allowlist)
    if (
      id === "true" ||
      id === "false" ||
      id === "null" ||
      id === "undefined" ||
      id === "date" ||
      id === "assign" ||
      id === "let"
    ) {
      continue;
    }
    out.add(id);
  }
  return out;
}

/**
 * Evaluate a Liquid-ish expression:
 *   - "literal"
 *   - 123 / 12.3
 *   - path.to.value
 *   - fn(arg1, arg2, ...)
 *   - <expr> | date: "%Y"
 *   - tiny arithmetic: a + b, a - b
 *
 * `vars` are the computed let-vars so lets can reference prior lets.
 * `ctx` is the mini root ctx: {cf, prbProperties, styles, ...un-namespaced locals...}
 */
function evalLiquidExpr(expr, { ctx, vars, locale = "en-US", diag }) {
  const raw = String(expr ?? "").trim();
  if (!raw) return "";

  // Very small arithmetic: a + b, a - b (no precedence, left-to-right)
  // Only at top-level (not inside fn calls)
  {
    const arith = raw.match(/^(.+?)\s*([+-])\s*(.+)$/);
    if (arith && !parseFnCall(raw)) {
      const left = evalLiquidExpr(arith[1], { ctx, vars, locale, diag });
      const right = evalLiquidExpr(arith[3], { ctx, vars, locale, diag });
      const ln = Number(left);
      const rn = Number(right);
      if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
        return String(arith[2] === "+" ? ln + rn : ln - rn);
      }
      // if not numeric, fall through to default behavior
    }
  }

  // Split pipelines: a | date: "%Y"
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);

  let base = parts[0] || "";
  let val;

  // fn calls
  const call = parseFnCall(base);
  if (call) {
    val = evalLiquidFn(call.name, call.argsRaw, { ctx, vars, locale, diag });
  } else {
    const lit = parseStringLiteral(base);
    const num = lit == null ? parseNumberLiteral(base) : null;

    if (lit != null) {
      val = lit;
    } else if (num != null) {
      val = num;
    } else if (base in (vars || {})) {
      val = vars[base];
    } else {
      val = getByPath(ctx, base);
    }
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

function evalLiquidFn(name, argsRaw, { ctx, vars, locale, diag }) {
  const args = splitArgs(argsRaw).map((a) => evalLiquidExpr(a, { ctx, vars, locale, diag }));

  switch (name) {
    case "toString":
      return String(args[0] ?? "");
    case "toInt":
      return String(parseInt(args[0] ?? "0", 10) || 0);
    case "concat":
      return args.map((a) => String(a ?? "")).join("");
    case "split": {
      const str = String(args[0] ?? "");
      const delim = String(args[1] ?? "");
      return str.split(delim);
    }
    case "head": {
      const arr = args[0];
      return Array.isArray(arr) && arr.length ? arr[0] : "";
    }
    case "get": {
      // get(obj, "path")
      const obj = args[0];
      const p = String(args[1] ?? "");
      if (obj && typeof obj === "object") return getByPath(obj, p);
      return "";
    }
    case "replaceAll": {
      const str = String(args[0] ?? "");
      const search = String(args[1] ?? "");
      const repl = String(args[2] ?? "");
      return str.split(search).join(repl);
    }
    case "includes": {
      const hay = args[0];
      const needle = String(args[1] ?? "");
      if (Array.isArray(hay)) return hay.map(String).includes(needle);
      return String(hay ?? "").includes(needle);
    }
    case "equals":
      return String(args[0] ?? "") === String(args[1] ?? "");
    case "formatDate": {
      // templates commonly use: formatDate(prbDate, "MM"/"LLLL"/"YYYY")
      const date = args[0];
      const fmt = String(args[1] ?? "");
      const d = safeDate(date);
      if (!d) return "";

      if (fmt === "YYYY") return String(d.getFullYear());
      if (fmt === "MM") return pad2(d.getMonth() + 1);
      if (fmt === "LLLL") return new Intl.DateTimeFormat(locale, { month: "long" }).format(d);

      return "";
    }
    default: {
      if (diag) {
        diag.liquid.unknownFns[name] = (diag.liquid.unknownFns[name] || 0) + 1;
      }
      return ""; // unknown fn: best-effort
    }
  }
}

/**
 * Parse all `{% let name = expr %}` blocks in-order.
 * Also supports `{% assign name = expr %}`.
 */
function parseLiquidLets(html) {
  const lets = [];
  if (!html || typeof html !== "string") return lets;

  const re = /{%\s*(?:let|assign)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]*?)\s*%}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    const expr = m[2];
    if (!name) continue;
    lets.push({ name, expr, raw: m[0] });
  }
  return lets;
}

/**
 * Expand needed vars by following dependencies on other let-vars.
 */
function expandNeededLets(lets, neededVars) {
  const needed = new Set(Array.isArray(neededVars) ? neededVars : neededVars instanceof Set ? [...neededVars] : []);
  if (!needed.size) return needed;

  // Build deps: letName -> referenced identifiers
  const deps = new Map();
  for (const l of lets) {
    deps.set(l.name, extractLetRefs(l.expr));
  }

  // Fixpoint expansion: if a needed let references another let, include it
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of lets) {
      if (!needed.has(l.name)) continue;
      const refIds = deps.get(l.name);
      if (!refIds) continue;

      for (const id of refIds) {
        if (deps.has(id) && !needed.has(id)) {
          needed.add(id);
          changed = true;
        }
      }
    }
  }

  return needed;
}

/**
 * Evaluate `{% let %}`/`{% assign %}` blocks.
 * If `neededVars` is provided, only evaluates the dependency-closed set of lets.
 */
function computeLiquidLets(html, { ctx, locale = "en-US", neededVars, diag } = {}) {
  const out = {};
  if (!html || typeof html !== "string") return out;

  const root = ctx && typeof ctx === "object" ? ctx : {};
  const lets = parseLiquidLets(html);

  const effectiveNeeded =
    neededVars && (Array.isArray(neededVars) || neededVars instanceof Set) ? expandNeededLets(lets, neededVars) : null;

  if (diag) {
    diag.counts.liquidLetsTotal = lets.length;
    diag.liquid.neededLets = effectiveNeeded ? Array.from(effectiveNeeded) : null;
  }

  for (const l of lets) {
    if (effectiveNeeded && !effectiveNeeded.has(l.name)) continue;
    out[l.name] = evalLiquidExpr(l.expr, { ctx: root, vars: out, locale, diag });
    if (diag) diag.liquid.evaluatedLets.push(l.name);
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
 *
 * Options:
 * - neededVars: Set/Array of top-level tokens we want to resolve (and their let deps)
 * - diag: diagnostics sink (from ensureDiagnostics)
 */
function evaluateLiquidLetsAndReplace(html, { ctx, locale = "en-US", neededVars, diag } = {}) {
  if (!html || typeof html !== "string") return html;

  const vars = computeLiquidLets(html, { ctx, locale, neededVars, diag });

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
 * Derived locals from PRB (Option 2 “small piece”):
 * Provide common computed values at top-level even if Liquid lets aren’t evaluated.
 */
function buildPrbDerivedLocals(prbCtx, locale = "en-US") {
  const prbNumber = prbCtx?.prbNumber ?? "";

  const d = safeDate(prbCtx?.startingDate ?? prbCtx?.startDate ?? null);
  const prbYear = d ? String(d.getFullYear()) : "";
  const prbMonth = d ? pad2(d.getMonth() + 1) : "";
  const prbMonthName = d ? new Intl.DateTimeFormat(locale, { month: "long" }).format(d) : "";

  return { prbNumber, prbYear, prbMonth, prbMonthName };
}

/**
 * Build the root context for the mini AJO runtime.
 *
 * CRITICAL:
 * Many templates assume the binding tag establishes an implicit "current" object,
 * and then reference fields un-namespaced (e.g. {{#each bodyCopy}}).
 *
 * So we:
 * - add derived PRB locals at the top-level (footer/global usage)
 * - spread localCtx at the top-level for un-namespaced access
 * - expose it as {{this.*}} as well
 * - ALSO keep canonical namespaces { cf, prbProperties, styles } so {{#each cf.bodyCopy}} works too
 */
function buildMiniAjoRootCtx({ cfCtx, prbCtx, stylesCtx, localCtx }) {
  const local = localCtx && typeof localCtx === "object" ? localCtx : null;

  // Derived PRB locals should be available globally, BUT allow the current local scope
  // (e.g., module item) to override if it defines the same keys.
  const prbLocals = buildPrbDerivedLocals(prbCtx, "en-US");

  return {
    // expose derived locals at root scope (footer/global usage)
    ...prbLocals,

    // existing behavior
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
  diag,
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

    // Evaluate only what’s needed (top-level vars present in this segment)
    const needed = collectTopLevelVarNames(maybeExpanded);
    maybeExpanded = evaluateLiquidLetsAndReplace(maybeExpanded, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

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

    // Evaluate only what’s needed inside this segment
    const needed = collectTopLevelVarNames(before);
    before = evaluateLiquidLetsAndReplace(before, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

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

  const needed = collectTopLevelVarNames(tail);
  tail = evaluateLiquidLetsAndReplace(tail, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

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
  diag,
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

    const needed = collectTopLevelVarNames(maybeExpanded);
    maybeExpanded = evaluateLiquidLetsAndReplace(maybeExpanded, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

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

    const needed = collectTopLevelVarNames(seg);
    seg = evaluateLiquidLetsAndReplace(seg, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

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

  const needed = collectTopLevelVarNames(tail);
  tail = evaluateLiquidLetsAndReplace(tail, { ctx: tailRoot, locale: "en-US", neededVars: needed, diag });

  out += replaceNamespaceVars(tail, "styles", currentStyles);

  return out;
}

/**
 * Build best-effort preview HTML.
 *
 * Backwards compatible:
 * - returns a string
 * - accepts optional `diagnostics` object to populate for your Diagnostics tab
 */
function buildRenderedHtmlBestEffort({ stitchedHtml, aemBindingsEncountered, aemPrefetchDataByStreamKey, diagnostics }) {
  const diag = ensureDiagnostics(diagnostics);
  const t0 = nowMs();
  if (diag) diag.timings.totalStartMs = t0;

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

  if (diag) {
    diag.counts.bindingsEncountered = Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered.length : 0;
    diag.counts.prefetchKeys = aemPrefetchDataByStreamKey ? Object.keys(aemPrefetchDataByStreamKey).length : 0;
    diag.counts.hasDefaultPrbCtx = !!defaultPrbCtx;
    diag.counts.hasDefaultCfCtx = !!defaultCfCtx;
  }

  // styles first (derived from PRB/CF binding order)
  {
    const t = nowMs();
    out = resolveStylesByBindings({
      stitchedHtml: out,
      aemBindingsEncountered,
      aemPrefetchDataByStreamKey,
      defaultPrbCtx,
      defaultCfCtx,
      diag,
    });
    if (diag) diag.timings.stylesMs = nowMs() - t;
  }

  // then normal namespaces
  {
    const t = nowMs();
    out = renderNamespaceByBindingOrder({
      html: out,
      namespace: "prbProperties",
      bindings: aemBindingsEncountered,
      dataByStreamKey: aemPrefetchDataByStreamKey,
      defaultCtx: defaultPrbCtx,
      defaultPrbCtx,
      defaultCfCtx,
      diag,
    });
    if (diag) diag.timings.prbNsMs = nowMs() - t;
  }

  {
    const t = nowMs();
    out = renderNamespaceByBindingOrder({
      html: out,
      namespace: "cf",
      bindings: aemBindingsEncountered,
      dataByStreamKey: aemPrefetchDataByStreamKey,
      defaultCtx: defaultCfCtx,
      defaultPrbCtx,
      defaultCfCtx,
      diag,
    });
    if (diag) diag.timings.cfNsMs = nowMs() - t;
  }

  // Final global liquid let evaluation using defaults (catches footer/global blocks),
  // but evaluate only what’s needed in the final output.
  {
    const t = nowMs();
    const miniRoot = buildMiniAjoRootCtx({
      cfCtx: defaultCfCtx,
      prbCtx: defaultPrbCtx,
      stylesCtx: deriveStylesContext({ prbCtx: defaultPrbCtx, cfCtx: defaultCfCtx }),
      localCtx: null,
    });

    const needed = collectTopLevelVarNames(out);
    out = evaluateLiquidLetsAndReplace(out, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

    if (diag) diag.timings.finalLiquidMs = nowMs() - t;
  }

  // Track unresolved top-level vars remaining
  if (diag) {
    const names = Array.from(collectTopLevelVarNames(out));
    const unresolved = names.filter((k) => out.includes(`{{${k}}}`) || out.includes(`{{{${k}}}}`));

    diag.unresolved.topLevelVars = unresolved;
    diag.counts.unresolvedTopLevelVarCount = unresolved.length;

    // Helpful rollups
    diag.counts.liquidLetsEvaluated = Array.isArray(diag.liquid.evaluatedLets) ? diag.liquid.evaluatedLets.length : 0;

    // Provide a concise “why” hint when common vars remain
    if (unresolved.length) {
      diagAddWarning(diag, "Unresolved top-level variables remain after preview render.", {
        unresolvedTopLevelVars: unresolved.slice(0, 50),
      });
    }
  }

  // final sanitize for preview HTML
  {
    const t = nowMs();
    out = stripAjoSyntax(out);
    if (diag) diag.timings.stripMs = nowMs() - t;
  }

  if (diag) {
    diag.timings.totalMs = nowMs() - t0;

    // If unknown Liquid fns were encountered, add a warning with the top offenders
    const unknown = diag.liquid.unknownFns || {};
    const keys = Object.keys(unknown);
    if (keys.length) {
      const top = keys
        .map((k) => ({ fn: k, count: unknown[k] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      diagAddWarning(diag, "Unknown Liquid function(s) encountered during preview let evaluation.", { top });
    }
  }

  return out;
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
  collectTopLevelVarNames,
  parseLiquidLets,
};
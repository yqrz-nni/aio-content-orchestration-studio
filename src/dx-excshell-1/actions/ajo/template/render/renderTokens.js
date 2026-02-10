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
  if (!rt.info) rt.info = []; // NEW: "INFO-level" events

  // convenience counters
  if (!rt.liquid.unknownFns) rt.liquid.unknownFns = {};
  if (!rt.liquid.evaluatedLets) rt.liquid.evaluatedLets = [];

  // dynamic references
  if (!rt.dynamicReferences) {
    rt.dynamicReferences = {
      enabled: true,
      wrapperInferred: null,
      wrapperCandidates: [],
      totalPlaceholdersSeen: 0,
      totalReplacementsMade: 0,
      totalUniqueReferences: 0,
      orderedReferenceNotes: [],
      perSegment: [],
      warnings: [],
      info: [], // NEW: "INFO-level" dynamic refs events
    };
  } else {
    // ensure new keys exist even if older object
    if (!rt.dynamicReferences.warnings) rt.dynamicReferences.warnings = [];
    if (!rt.dynamicReferences.info) rt.dynamicReferences.info = [];
    if (!rt.dynamicReferences.perSegment) rt.dynamicReferences.perSegment = [];
    if (!rt.dynamicReferences.wrapperCandidates) rt.dynamicReferences.wrapperCandidates = [];
  }

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

// NEW
function diagAddInfo(rt, msg, meta) {
  if (!rt) return;
  rt.info.push(meta ? { message: msg, ...meta } : { message: msg });
}

/* =============================================================================
 * Preview sanitizer:
 * Remove *wrapper syntax* from rendered preview HTML only.
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
 * ============================================================================= */

function safeDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  const s = String(n ?? "");
  return s.length === "1" ? `0${s}` : s;
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
 * Evaluate a Liquid-ish expression.
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
 */
function evaluateLiquidLetsAndReplace(html, { ctx, locale = "en-US", neededVars, diag } = {}) {
  if (!html || typeof html !== "string") return html;

  const vars = computeLiquidLets(html, { ctx, locale, neededVars, diag });

  let out = replaceLiquidVarTokens(html, vars);

  // Remove let/assign tags now (also stripped later)
  out = out.replace(/{%\s*(?:let|assign)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*[\s\S]*?\s*%}/g, "");

  return out;
}

/* =============================================================================
 * Dynamic References Resolver (scalable, name-agnostic)
 * ============================================================================= */

function createDynamicReferencesState() {
  return {
    wrapper: null, // e.g., "##"
    wrapperCandidates: new Map(), // wrapper -> count

    noteToNumber: new Map(), // note -> global #
    orderedNotes: [], // global list

    placeholdersSeen: 0,
    replacementsMade: 0,

    // extra visibility
    supHandlebarsSeen: 0,
    supHandlebarsReplaced: 0,
    wrapperPlaceholdersSeen: 0,
    wrapperPlaceholdersReplaced: 0,
  };
}

/**
 * Infer wrapper from HTML content by looking for <sup>WRAPdigits</sup> patterns.
 * We keep it conservative to avoid matching HTML tokens.
 */
function inferWrapperFromHtml(html) {
  if (!html || typeof html !== "string") return null;

  const re = /<sup[^>]*>\s*([^\w\s<>&"']{1,6})(\d{1,3})\s*<\/sup>/gi;
  const freq = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const wrapper = m[1];
    if (!wrapper) continue;
    freq.set(wrapper, (freq.get(wrapper) || 0) + 1);
  }

  if (!freq.size) return null;

  let best = null;
  let bestCount = -1;
  for (const [w, c] of freq.entries()) {
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

function snapshotWrapperCandidates(map) {
  const arr = [];
  for (const [w, c] of map.entries()) arr.push({ wrapper: w, count: c });
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, 20);
}

/**
 * Extract referenceNote strings from a cf-like context.
 * Heuristic: prefer ctx.references[*].referenceNote if present.
 */
function extractReferenceNotesFromCf(cfCtx) {
  const refs = cfCtx?.references;
  if (!Array.isArray(refs) || !refs.length) return [];

  const notes = [];
  for (const r of refs) {
    const n = r && typeof r === "object" ? r.referenceNote ?? getByPath(r, "referenceNote") : null;
    const s = typeof n === "string" ? n : coerceValue(n);
    notes.push(String(s ?? ""));
  }
  return notes;
}

function assignGlobalRefNumber(dynState, note) {
  if (!dynState) return null;
  const key = String(note ?? "");
  if (!key) return null;

  let globalNum = dynState.noteToNumber.get(key);
  const wasNew = globalNum == null;

  if (wasNew) {
    globalNum = dynState.orderedNotes.length + 1;
    dynState.noteToNumber.set(key, globalNum);
    dynState.orderedNotes.push(key);
  }

  return { globalNum, wasNew };
}

function getCfIdForLogs(cfCtx) {
  if (!cfCtx || typeof cfCtx !== "object") return null;
  return (
    cfCtx._id ||
    cfCtx.id ||
    cfCtx.contentFragmentId ||
    cfCtx.aemId ||
    (typeof cfCtx._path === "string" ? cfCtx._path : null) ||
    null
  );
}

// IMPORTANT: these are NOT Liquid lets; they are handlebars fragment param tokens.
const REF_LOCAL_NAMES = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"];

/**
 * Convert handlebars ref tokens to wrapper placeholders.
 * Example: <sup>{{r1}}</sup> -> <sup>##1</sup>
 *
 * We do this BEFORE wrapper inference so inferWrapperFromHtml can see "##1".
 * This is best-effort and intentionally narrow (only r1..r10).
 */
function rewriteRefHandlebarsToWrapperPlaceholders(html, dynState) {
  if (!html || typeof html !== "string") return html;

  const wrapper = (dynState && typeof dynState.wrapper === "string" && dynState.wrapper) || "##";

  // Match {{rN}} or {{{rN}}} where rN is in allowlist (r1..r10)
  const keyAlt = REF_LOCAL_NAMES.map(escapeRegExp).join("|");
  const re = new RegExp(String.raw`\{\{\{?\s*(${keyAlt})\s*\}\}?\}`, "g");

  return html.replace(re, (_m, k) => {
    const mm = String(k || "").match(/^r(\d{1,2})$/i);
    const n = mm ? Number(mm[1]) : null;
    if (!n || !Number.isFinite(n)) return _m;
    return `${wrapper}${n}`;
  });
}

/**
 * Phase 2 (wrapper-based):
 * Resolve placeholders like "##1" in a segment using cf.references ordering.
 */
function resolveWrapperPlaceholders({ html, notes, dynState, diag, segmentKey, cfId }) {
  if (!html || typeof html !== "string") return { out: html, mapping: [] };
  if (!dynState) return { out: html, mapping: [] };

  // Always attempt to infer from this segment (for candidates + visibility)
  const inferred = inferWrapperFromHtml(html);
  if (inferred) {
    dynState.wrapperCandidates.set(inferred, (dynState.wrapperCandidates.get(inferred) || 0) + 1);
  }

  // If wrapper not known yet, adopt inferred wrapper
  if (!dynState.wrapper && inferred) dynState.wrapper = inferred;

  // Always refresh diagnostics wrapper candidates + inferred wrapper (even if wrapper already set)
  if (diag?.dynamicReferences) {
    diag.dynamicReferences.wrapperCandidates = snapshotWrapperCandidates(dynState.wrapperCandidates);

    if (dynState.wrapper && typeof dynState.wrapper === "string") {
      diag.dynamicReferences.wrapperInferred = dynState.wrapper;
    }
  }

  if (!dynState.wrapper) return { out: html, mapping: [] };

  const wrapper = dynState.wrapper;

  const phRe = new RegExp(`${escapeRegExp(wrapper)}(\\d{1,3})`, "g");

  // Collect unique local indices in this segment
  const localIdxs = new Set();
  let m;
  while ((m = phRe.exec(html)) !== null) {
    const idx = Number(m[1]);
    if (Number.isFinite(idx) && idx > 0) localIdxs.add(idx);
  }

  if (!localIdxs.size) return { out: html, mapping: [] };

  dynState.wrapperPlaceholdersSeen += localIdxs.size;
  dynState.placeholdersSeen += localIdxs.size;

  const mapping = [];
  let out = html;

  for (const localIdx of Array.from(localIdxs).sort((a, b) => a - b)) {
    const note = notes[localIdx - 1] ?? "";

    if (!note) {
      if (diag?.dynamicReferences) {
        diag.dynamicReferences.warnings.push({
          message: "Wrapper placeholder index had no matching cf.references entry.",
          segmentKey,
          cfId,
          wrapper,
          localIdx,
          referencesLength: notes.length,
        });
      }
      continue;
    }

    const assigned = assignGlobalRefNumber(dynState, note);
    if (!assigned) continue;

    const targetRe = new RegExp(`${escapeRegExp(wrapper)}${localIdx}\\b`, "g");

    const before = out;
    out = out.replace(targetRe, String(assigned.globalNum));

    if (out !== before) {
      dynState.wrapperPlaceholdersReplaced += 1;
      dynState.replacementsMade += 1;
    }

    mapping.push({
      kind: "wrapper",
      cfId,
      wrapper,
      localIdx,
      tokenName: `r${localIdx}`,
      note,
      globalNum: assigned.globalNum,
      wasNew: assigned.wasNew,
    });
  }

  return { out, mapping };
}

/**
 * Run wrapper-based dynamic reference resolution for a segment.
 */
function resolveDynamicReferencesInSegment({ html, cfCtx, dynState, diag, segmentKey }) {
  if (!html || typeof html !== "string") return html;
  if (!dynState) return html;

  const notes = extractReferenceNotesFromCf(cfCtx);
  const cfId = getCfIdForLogs(cfCtx);

  // Step 0: rewrite {{rN}} -> ##N so wrapper inference + placeholder scanning works.
  let working = rewriteRefHandlebarsToWrapperPlaceholders(html, dynState);

  const combinedMapping = [];

  const wrap = resolveWrapperPlaceholders({
    html: working,
    notes,
    dynState,
    diag,
    segmentKey,
    cfId,
  });

  let out = wrap.out;
  combinedMapping.push(...wrap.mapping);

  // INFO logging: tell user exactly what was resolved for this CF segment
  if (diag?.dynamicReferences && combinedMapping.length) {
    for (const m of combinedMapping) {
      if (m.kind !== "wrapper") continue;

      const msg = `AEM CF ID ${m.cfId || "(unknown)"}: {{${m.tokenName}}} resolved as global ref ${m.globalNum} ("${String(
        m.note ?? ""
      )}")`;

      // cap growth
      if (diag.dynamicReferences.info.length < 500) {
        diag.dynamicReferences.info.push({
          message: msg,
          segmentKey,
          cfId: m.cfId || null,
          token: `{{${m.tokenName}}}`,
          wrapper: m.wrapper,
          localIdx: m.localIdx,
          globalNum: m.globalNum,
          referenceNote: m.note,
        });
      }
    }
  }

  if (diag?.dynamicReferences) {
    diag.dynamicReferences.totalPlaceholdersSeen = dynState.placeholdersSeen;
    diag.dynamicReferences.totalReplacementsMade = dynState.replacementsMade;
    diag.dynamicReferences.totalUniqueReferences = dynState.orderedNotes.length;
    diag.dynamicReferences.orderedReferenceNotes = dynState.orderedNotes.slice(0, 200);

    diag.dynamicReferences.perSegment.push({
      segmentKey,
      cfId,
      wrapper: dynState.wrapper,
      referencesLength: notes.length,
      mapping: combinedMapping,
      counters: {
        supHandlebarsSeen: dynState.supHandlebarsSeen,
        supHandlebarsReplaced: dynState.supHandlebarsReplaced,
        wrapperPlaceholdersSeen: dynState.wrapperPlaceholdersSeen,
        wrapperPlaceholdersReplaced: dynState.wrapperPlaceholdersReplaced,
      },
    });
  }

  return out;
}

/**
 * Render any leftover {{#each refArray ...}} blocks at the very end using dynState.orderedNotes.
 * This avoids needing to emulate the author’s split/allReferences logic.
 */
function renderRefArrayBlocksBestEffort(html, dynState) {
  if (!html || typeof html !== "string") return html;
  if (!dynState || !Array.isArray(dynState.orderedNotes)) return html;
  if (!dynState.orderedNotes.length) return html;

  // This is intentionally global: if an author used refArray loop anywhere, we fill it.
  return renderMiniAjo(html, { refArray: dynState.orderedNotes });
}

/* =============================================================================
 * Styles + binding-order render helpers
 * ============================================================================= */

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

function deriveStylesContext({ prbCtx, cfCtx }) {
  const prbStyle = prbCtx?.brandStyle && typeof prbCtx.brandStyle === "object" ? prbCtx.brandStyle : null;

  const cfOverride =
    cfCtx?.forceBrandStylingLeaveBlankToInheritContextualBrandStyle &&
    typeof cfCtx.forceBrandStylingLeaveBlankToInheritContextualBrandStyle === "object"
      ? cfCtx.forceBrandStylingLeaveBlankToInheritContextualBrandStyle
      : null;

  return cfOverride || prbStyle || null;
}

function buildPrbDerivedLocals(prbCtx, locale = "en-US") {
  const prbNumber = prbCtx?.prbNumber ?? "";

  const d = safeDate(prbCtx?.startingDate ?? prbCtx?.startDate ?? null);
  const prbYear = d ? String(d.getFullYear()) : "";
  const prbMonth = d ? pad2(d.getMonth() + 1) : "";
  const prbMonthName = d ? new Intl.DateTimeFormat(locale, { month: "long" }).format(d) : "";

  return { prbNumber, prbYear, prbMonth, prbMonthName };
}

function buildMiniAjoRootCtx({ cfCtx, prbCtx, stylesCtx, localCtx }) {
  const local = localCtx && typeof localCtx === "object" ? localCtx : null;

  const prbLocals = buildPrbDerivedLocals(prbCtx, "en-US");

  return {
    ...prbLocals,

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
  dynamicReferences, // { enabled, state }
}) {
  if (!html) return html;

  const binds = (Array.isArray(bindings) ? bindings : [])
    .filter((b) => b?.result === namespace && typeof b?.rawTag === "string")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  const dynEnabled = !!dynamicReferences?.enabled;
  const dynState = dynamicReferences?.state || null;

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

    const needed = collectTopLevelVarNames(maybeExpanded);
    maybeExpanded = evaluateLiquidLetsAndReplace(maybeExpanded, {
      ctx: miniRoot,
      locale: "en-US",
      neededVars: needed,
      diag,
    });

    // Dynamic references (only meaningful with cf context)
    if (dynEnabled && namespace === "cf") {
      maybeExpanded = resolveDynamicReferencesInSegment({
        html: maybeExpanded,
        cfCtx: defaultCtx,
        dynState,
        diag,
        segmentKey: "cf:default",
      });
    }

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

    before = renderMiniAjo(before, miniRoot);

    const needed = collectTopLevelVarNames(before);
    before = evaluateLiquidLetsAndReplace(before, { ctx: miniRoot, locale: "en-US", neededVars: needed, diag });

    // Dynamic references pass per segment (only cf)
    if (dynEnabled && namespace === "cf") {
      const segKey = `cf:${b.index ?? "?"}`;
      before = resolveDynamicReferencesInSegment({
        html: before,
        cfCtx: effectiveCtx,
        dynState,
        diag,
        segmentKey: segKey,
      });
    }

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

  if (dynEnabled && namespace === "cf") {
    tail = resolveDynamicReferencesInSegment({
      html: tail,
      cfCtx: effectiveCtx,
      dynState,
      diag,
      segmentKey: "cf:tail",
    });
  }

  out += replaceNamespaceVars(tail, namespace, effectiveCtx);

  return out;
}

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
    maybeExpanded = evaluateLiquidLetsAndReplace(maybeExpanded, {
      ctx: miniRoot,
      locale: "en-US",
      neededVars: needed,
      diag,
    });

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

  // Dynamic refs global state for the full email render
  const dynState = createDynamicReferencesState();
  const dynConfig = { enabled: true, state: dynState };

  // styles first
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

  // prbProperties namespace
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
      dynamicReferences: dynConfig,
    });
    if (diag) diag.timings.prbNsMs = nowMs() - t;
  }

  // cf namespace (dynamic refs are primarily tied to cf.references)
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
      dynamicReferences: dynConfig,
    });
    if (diag) diag.timings.cfNsMs = nowMs() - t;
  }

  // Final global liquid let evaluation using defaults (catches footer/global blocks)
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

  // Render any leftover refArray loops using our accumulated orderedNotes
  {
    const t = nowMs();
    out = renderRefArrayBlocksBestEffort(out, dynState);
    if (diag) diag.timings.dynamicRefsRefArrayMs = nowMs() - t;

    if (diag?.dynamicReferences) {
      // Always set wrapperInferred when known
      diag.dynamicReferences.wrapperInferred = dynState.wrapper || diag.dynamicReferences.wrapperInferred || null;

      // Always publish wrapper candidates (even if wrapper was already known)
      diag.dynamicReferences.wrapperCandidates = snapshotWrapperCandidates(dynState.wrapperCandidates);

      diag.dynamicReferences.totalPlaceholdersSeen = dynState.placeholdersSeen;
      diag.dynamicReferences.totalReplacementsMade = dynState.replacementsMade;
      diag.dynamicReferences.totalUniqueReferences = dynState.orderedNotes.length;
      diag.dynamicReferences.orderedReferenceNotes = dynState.orderedNotes.slice(0, 200);

      diag.dynamicReferences.supHandlebarsSeen = dynState.supHandlebarsSeen;
      diag.dynamicReferences.supHandlebarsReplaced = dynState.supHandlebarsReplaced;
      diag.dynamicReferences.wrapperPlaceholdersSeen = dynState.wrapperPlaceholdersSeen;
      diag.dynamicReferences.wrapperPlaceholdersReplaced = dynState.wrapperPlaceholdersReplaced;
    }
  }

  // Track unresolved top-level vars remaining
  if (diag) {
    const names = Array.from(collectTopLevelVarNames(out));
    const unresolved = names.filter((k) => out.includes(`{{${k}}}`) || out.includes(`{{{${k}}}}`));

    diag.unresolved.topLevelVars = unresolved;
    diag.counts.unresolvedTopLevelVarCount = unresolved.length;

    diag.counts.liquidLetsEvaluated = Array.isArray(diag.liquid.evaluatedLets) ? diag.liquid.evaluatedLets.length : 0;

    if (unresolved.length) {
      diagAddWarning(diag, "Unresolved top-level variables remain after preview render.", {
        unresolvedTopLevelVars: unresolved.slice(0, 50),
      });
    }

    // Bubble a compact INFO summary at the top-level too (handy for your UI)
    const drInfo = diag.dynamicReferences?.info || [];
    if (drInfo.length) {
      diagAddInfo(diag, "Dynamic references: wrapper-based replacements performed.", {
        count: drInfo.length,
        examples: drInfo.slice(0, 25).map((x) => x.message),
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

    const unknown = diag.liquid.unknownFns || {};
    const keys = Object.keys(unknown);
    if (keys.length) {
      const top = keys
        .map((k) => ({ fn: k, count: unknown[k] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      diagAddWarning(diag, "Unknown Liquid function(s) encountered during preview let evaluation.", { top });
    }

    // also bubble dynamic reference warnings into main warnings (light touch)
    const drw = diag.dynamicReferences?.warnings || [];
    if (drw.length) {
      diagAddWarning(diag, "Dynamic references: warnings encountered during placeholder resolution.", {
        count: drw.length,
        examples: drw.slice(0, 10),
      });
    }
  }

  return out;
}

module.exports = {
  stripAjoSyntax,
  buildRenderedHtmlBestEffort,

  replaceNamespaceVars,
  renderNamespaceByBindingOrder,
  resolveStylesByBindings,
  pickDefaultCtxForNamespace,
  deriveStylesContext,
  stripKnownEmptyEachBlocks,

  evaluateLiquidLetsAndReplace,
  computeLiquidLets,
  evalLiquidExpr,
  collectTopLevelVarNames,
  parseLiquidLets,
};
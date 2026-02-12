// File: src/dx-excshell-1/web-src/src/studio/previewPipeline.js

/* =============================================================================
 * Preview pipeline: variable resolution, sanitizer, diagnostics
 * ============================================================================= */

export function escapeHtml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function coerceValue(val) {
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);

  if (typeof val === "object") {
    if (typeof val._path === "string") return val._path;
    if (val._path && typeof val._path === "object" && typeof val._path._path === "string") return val._path._path;
    if (typeof val.html === "string") return val.html;
    if (typeof val.plaintext === "string") return val.plaintext;
  }

  try {
    return JSON.stringify(val);
  } catch {
    return "";
  }
}

export function getByPath(obj, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function replaceNamespaceVars(segment, namespace, ctx) {
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

export function resolveNamespaceByBindings({ stitchedHtml, namespace, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
  if (!stitchedHtml) return stitchedHtml;

  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : [])
    .filter((b) => b?.result === namespace && typeof b?.rawTag === "string" && Number.isFinite(Number(b?.index)))
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  if (!binds.length) return stitchedHtml;

  let cursor = 0;
  let out = "";
  let currentCtx = null;

  for (const b of binds) {
    const tag = b.rawTag;
    const tagPos = stitchedHtml.indexOf(tag, cursor);
    if (tagPos < 0) continue;

    const before = stitchedHtml.slice(cursor, tagPos);
    out += replaceNamespaceVars(before, namespace, currentCtx);

    out += tag;

    cursor = tagPos + tag.length;

    const streamKey = `${b.index}:${b.result}`;
    currentCtx = aemPrefetchDataByStreamKey?.[streamKey] ?? null;
  }

  out += replaceNamespaceVars(stitchedHtml.slice(cursor), namespace, currentCtx);
  return out;
}

function derivePrbContext(aemBindingsEncountered, aemPrefetchDataByStreamKey) {
  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : []).filter((b) => b?.result === "prbProperties");
  if (!binds.length) return null;

  const streamKey = `${binds[0].index}:${binds[0].result}`;
  const prb = aemPrefetchDataByStreamKey?.[streamKey];
  if (!prb || typeof prb !== "object") return null;

  const brandProps = Array.isArray(prb.brands) ? prb.brands[0] : null;
  const styles = prb.brandStyle || null;

  let prbDate = null;
  if (prb.startingDate) {
    const d = new Date(prb.startingDate);
    if (!Number.isNaN(d.getTime())) prbDate = d;
  }

  let prbMonth = "";
  let prbMonthName = "";
  let prbYear = "";

  if (prbDate) {
    const month = prbDate.getMonth() + 1;
    prbMonth = month < 10 ? `0${month}` : String(month);
    prbYear = String(prbDate.getFullYear());
    try {
      prbMonthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(prbDate);
    } catch {
      prbMonthName = "";
    }
  }

  return {
    brandProps,
    styles,
    prbNumber: prb.prbNumber || "",
    prbDate,
    prbMonth,
    prbMonthName,
    prbYear,
  };
}

function replaceDerivedVars(html, ctx) {
  if (!html || !ctx) return html;
  let out = html;

  const nsReplacements = [
    { ns: "brandProps", value: ctx.brandProps },
    { ns: "styles", value: ctx.styles },
  ];

  for (const { ns, value } of nsReplacements) {
    if (!value) continue;
    const triple = new RegExp(`\\{\\{\\{\\s*${ns}\\.([a-zA-Z0-9_$.]+)\\s*\\}\\}\\}`, "g");
    const dbl = new RegExp(`\\{\\{\\s*${ns}\\.([a-zA-Z0-9_$.]+)\\s*\\}\\}`, "g");

    out = out.replace(triple, (_m, path) => coerceValue(getByPath(value, path)));
    out = out.replace(dbl, (_m, path) => escapeHtml(coerceValue(getByPath(value, path))));
  }

  const top = {
    prbNumber: ctx.prbNumber,
    prbMonth: ctx.prbMonth,
    prbMonthName: ctx.prbMonthName,
    prbYear: ctx.prbYear,
  };

  for (const [key, val] of Object.entries(top)) {
    if (val == null || val === "") continue;
    const triple = new RegExp(`\\{\\{\\{\\s*${key}\\s*\\}\\}\\}`, "g");
    const dbl = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    out = out.replace(triple, coerceValue(val));
    out = out.replace(dbl, escapeHtml(coerceValue(val)));
  }

  return out;
}

export function resolveCfByStructure({ stitchedHtml, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
  if (!stitchedHtml) return stitchedHtml;

  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : []).filter((b) => b?.result === "cf");
  if (!binds.length) return stitchedHtml;

  if (typeof DOMParser === "undefined") {
    return resolveNamespaceByBindings({
      stitchedHtml,
      namespace: "cf",
      aemBindingsEncountered: binds,
      aemPrefetchDataByStreamKey,
    });
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(stitchedHtml, "text/html");
  const structures = doc.querySelectorAll(".acr-structure");
  if (!structures.length) {
    return resolveNamespaceByBindings({
      stitchedHtml,
      namespace: "cf",
      aemBindingsEncountered: binds,
      aemPrefetchDataByStreamKey,
    });
  }

  structures.forEach((structure) => {
    const html = structure.innerHTML;
    if (!html) return;

    const structBinds = binds.filter((b) => b?.rawTag && html.includes(b.rawTag));
    if (!structBinds.length) return;

    const replaced = resolveNamespaceByBindings({
      stitchedHtml: html,
      namespace: "cf",
      aemBindingsEncountered: structBinds,
      aemPrefetchDataByStreamKey,
    });
    structure.innerHTML = replaced;
  });

  const docHtml = doc.documentElement?.outerHTML || stitchedHtml;
  return stitchedHtml.trimStart().toLowerCase().startsWith("<!doctype") ? `<!DOCTYPE html>\n${docHtml}` : docHtml;
}

function hasUnboundVfModules(html) {
  if (!html || typeof html !== "string") return false;
  if (typeof DOMParser === "undefined") return /ajo:[^'"]+/.test(html) && !/result=(['"])cf\1/.test(html);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const structures = doc.querySelectorAll(".acr-structure");
    if (!structures.length) return false;

    for (const structure of structures) {
      const hasVf = structure.querySelector('[data-fragment-id^="ajo:"]') || /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:/i.test(structure.innerHTML);
      if (!hasVf) continue;

      const hasCf = /{{\s*fragment\b[^}]*\bresult\s*=\s*(['"])cf\1/i.test(structure.innerHTML);
      if (!hasCf) return true;
    }
  } catch {
    return false;
  }

  return false;
}

function stripAemFragmentTags(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(/{{\s*fragment\b[^}]*\bid\s*=\s*(['"])aem:[^'"]+\1[^}]*}}/gim, "");
}

function stripAjoFragmentTags(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(/{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:[^'"]+\1[^}]*}}/gim, "");
}

export function resolvePreviewHtmlFromRenderResult(renderResult, fallbackHtml) {
  if (typeof renderResult?.renderedHtml === "string" && renderResult.renderedHtml.trim()) {
    // Server-side renderedHtml is the most faithful preview representation and
    // already includes fragment stitching + token/render logic.
    return renderResult.renderedHtml;
  }

  const stitchedHtml = renderResult?.stitchedHtml ?? renderResult?.html ?? fallbackHtml ?? "";

  const resolvedPrb = resolveNamespaceByBindings({
    stitchedHtml,
    namespace: "prbProperties",
    aemBindingsEncountered: renderResult?.aemBindingsEncountered,
    aemPrefetchDataByStreamKey: renderResult?.aemPrefetchDataByStreamKey,
  });

  const derivedPrbCtx = derivePrbContext(renderResult?.aemBindingsEncountered, renderResult?.aemPrefetchDataByStreamKey);
  const resolvedDerivedPrb = replaceDerivedVars(resolvedPrb, derivedPrbCtx);

  const resolvedCf = resolveCfByStructure({
    stitchedHtml: resolvedDerivedPrb,
    aemBindingsEncountered: renderResult?.aemBindingsEncountered,
    aemPrefetchDataByStreamKey: renderResult?.aemPrefetchDataByStreamKey,
  });

  const best = resolvedCf || resolvedDerivedPrb || resolvedPrb || stitchedHtml || fallbackHtml || "";
  return stripAjoFragmentTags(stripAemFragmentTags(best));
}

export function stripAjoSyntax(html) {
  if (!html || typeof html !== "string") return html;

  let out = html;

  // Remove Liquid tags like {% let x = ... %}
  out = out.replace(/{%\s*[\s\S]*?\s*%}/g, "");

  // Remove ACR marker comments only; keep enclosed stitched content.
  out = out.replace(/{{!--\s*\[acr-(?:start|end)[^\]]*\]\s*--}}/gim, "");

  // Remove unresolved Handlebars block control tags that can leak into preview.
  // Keep normal {{var}} bindings (for unresolved-but-expected placeholders).
  out = out
    .replace(/{{\s*#\w+[^}]*}}/g, "")
    .replace(/{{\s*\/\w+\s*}}/g, "");

  return out;
}

export function injectPreviewBridge(html, expectedVfIds = []) {
  const uniq = [...new Set((expectedVfIds || []).filter(Boolean))];

  const payload = uniq.map((id) => ({
    id,
    selector: `[data-fragment-id="ajo:${id}"]`,
  }));

  const script = `
<script>
(function(){
  function post(type, data){
    try{
      parent.postMessage({ __TS_PREVIEW__: true, type: type, data: data }, "*");
    }catch(e){}
  }

  window.addEventListener("error", function(ev){
    post("error", { message: String(ev && ev.message || "error"), filename: ev && ev.filename, lineno: ev && ev.lineno, colno: ev && ev.colno });
  });

  window.addEventListener("unhandledrejection", function(ev){
    var reason = ev && ev.reason;
    post("unhandledrejection", { message: (reason && (reason.message || String(reason))) || "unhandledrejection" });
  });

  document.addEventListener("DOMContentLoaded", function(){
    post("DOMContentLoaded", { title: document.title, url: location.href });

    var checks = ${JSON.stringify(payload)};
    var found = {};
    for (var i=0;i<checks.length;i++){
      var c = checks[i];
      found[c.id] = !!document.querySelector(c.selector);
    }
    post("vf-dom-check", { found: found, total: checks.length });

    var any = Array.prototype.slice.call(document.querySelectorAll('[data-fragment-id^="ajo:"]')).map(function(n){ return n.getAttribute("data-fragment-id"); });
    post("vf-dom-any", { count: any.length, ids: any.slice(0, 15) });
  });
})();
</script>
`;

  if (typeof html === "string" && html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }
  return `${html}\n${script}`;
}

export function computePreviewWarnings({ canonicalHtml, bestHtml, sanitizedHtml, expectedVfIds = [] }) {
  const warnings = [];

  const canon = canonicalHtml || "";
  const best = bestHtml || "";
  const after = sanitizedHtml || "";

  const uniq = [...new Set((expectedVfIds || []).filter(Boolean))];

  for (const id of uniq) {
    const hasInCanonical =
      canon.includes(`ajo:${id}`) || canon.includes(`data-fragment-id="ajo:${id}"`) || canon.includes(`data-fragment-id='ajo:${id}'`);
    const hasInBest =
      best.includes(`ajo:${id}`) || best.includes(`data-fragment-id="ajo:${id}"`) || best.includes(`data-fragment-id='ajo:${id}'`);
    const hasInAfter =
      after.includes(`ajo:${id}`) || after.includes(`data-fragment-id="ajo:${id}"`) || after.includes(`data-fragment-id='ajo:${id}'`);

    if (hasInCanonical && !hasInBest) {
      warnings.push(
        `VF ajo:${id} is present in canonical AJO HTML,, but missing from render result HTML (best). This points to the render action dropping/omitting it.`
      );
      continue;
    }

    if (hasInBest && !hasInAfter) {
      warnings.push(
        `VF ajo:${id} was present in render result HTML (best) but missing after sanitization. This points to the sanitizer stripping it.`
      );
      continue;
    }

    const hasDomMarker = after.includes(`data-fragment-id="ajo:${id}"`) || after.includes(`data-fragment-id='ajo:${id}'`);
    const hasTemplateTag = after.includes(`ajo:${id}`);

    if (hasTemplateTag && !hasDomMarker) {
      warnings.push(
        `VF ajo:${id} is still present as a template tag in preview HTML, but not as rendered DOM (data-fragment-id). Browsers can't render {{ fragment ... }}; the render action needs to stitch/inline the VF content.`
      );
    }
  }

  const anyAjoTags = /\{\{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:/i.test(after);
  if (anyAjoTags) {
    warnings.push(
      "Preview HTML still contains AJO fragment includes (ajo:...). That means fragments were not stitched/resolved before rendering in the iframe."
    );
  }

  const acrMarkerCount = (after.match(/{{!--\s*\[acr-(?:start|end)[^\]]*\]\s*--}}/gim) || []).length;
  if (acrMarkerCount > 0) warnings.push(`ACR marker comments still present in preview HTML (${acrMarkerCount}).`);

  const liquidCount = (after.match(/{%\s*[\s\S]*?\s*%}/g) || []).length;
  if (liquidCount > 0) warnings.push(`Liquid tags still present in preview HTML (${liquidCount}).`);

  return warnings.slice(0, 12);
}

export function extractAllAjoVfIdsFromHtml(html) {
  if (!html || typeof html !== "string") return [];
  const ids = new Set();

  // Matches {{ fragment id="ajo:<uuid>" ... }} and {{fragment id='ajo:<uuid>' ...}}
  const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:([^'"]+)\1[^}]*}}/gim;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[2]) ids.add(m[2]);
  }

  // If already stitched: data-fragment-id="ajo:<id>"
  const re2 = /data-fragment-id\s*=\s*(['"])ajo:([^'"]+)\1/gim;
  while ((m = re2.exec(html)) !== null) {
    if (m[2]) ids.add(m[2]);
  }

  return [...ids];
}

export function injectPreviewMarkers(html) {
  if (!html || typeof html !== "string") return html;
  // Prefer module markers so we can disambiguate duplicate VFs.
  const moduleCommentRe = /<!--\s*ts:module\s+id="([^"]+)"\s*-->/gim;
  let out = html.replace(moduleCommentRe, (_m, moduleId) => {
    if (!moduleId) return _m;
    return `<span data-ts-module-id="${moduleId}" data-ts-marker="true"></span>`;
  });

  const moduleRe =
    /<!--\s*ts:module\s+id="([^"]+)"\s*-->([\s\S]*?)({{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:([^'"]+)\4[^}]*}})/gim;

  out = out.replace(moduleRe, (_m, moduleId, before, frag, _q, vfId) => {
    if (!moduleId || !vfId) return _m;
    const marker = `<span data-ts-module-id="${moduleId}" data-fragment-id="ajo:${vfId}" data-ts-marker="true"></span>`;
    return `<!-- ts:module id="${moduleId}" -->${before}${marker}${frag}`;
  });

  const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:([^'"]+)\1[^}]*}}/gim;
  out = out.replace(re, (m, _q, id, offset, full) => {
    if (!id) return m;
    const prefix = full.slice(Math.max(0, offset - 160), offset);
    if (prefix.includes('data-ts-marker="true"')) return m;
    return `<span data-fragment-id="ajo:${id}" data-ts-marker="true"></span>${m}`;
  });

  return out;
}

export function injectPreviewFocusBridge(html) {
  const script = `
<style>
  .ts-vf-focus {
    outline: 2px solid #2f6fed;
    box-shadow: 0 0 0 4px rgba(47, 111, 237, 0.18);
    transition: outline-color 120ms ease, box-shadow 120ms ease;
  }
</style>
<script>
(function(){
  function clearFocus(){
    var nodes = document.querySelectorAll('[data-fragment-id^="ajo:"]');
    for (var i=0;i<nodes.length;i++) nodes[i].classList.remove('ts-vf-focus');
  }

  function focusById(vfId){
    if (!vfId) return clearFocus();
    clearFocus();
    var selector = '[data-fragment-id="ajo:' + vfId + '"]';
    var hits = document.querySelectorAll(selector);
    for (var i=0;i<hits.length;i++) hits[i].classList.add('ts-vf-focus');
    if (hits.length) {
      try { hits[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
    }
  }

  window.addEventListener('message', function(ev){
    var msg = ev && ev.data;
    if (!msg || msg.__TS_PREVIEW__ !== true) return;
    if (msg.type === 'focus-vf') {
      try { parent.postMessage({ __TS_PREVIEW__: true, type: 'focus-ack', data: msg }, "*"); } catch(e) {}
      var vfId = msg.vfId;
      var ord = typeof msg.vfOrdinal === 'number' ? msg.vfOrdinal : null;
      if (vfId) {
        clearFocus();
        var hits = document.querySelectorAll('[data-fragment-id="ajo:' + vfId + '"]');
        if (hits && hits.length) {
          var idx = ord != null ? Math.min(Math.max(ord, 0), hits.length - 1) : 0;
          var t = hits[idx];
          if (t) t.classList.add('ts-vf-focus');
          try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
          return;
        }
      }
      if (msg.moduleId) {
        clearFocus();
        var marker = document.querySelector('[data-ts-module-id="' + msg.moduleId + '"]');
        if (marker) {
          var target = marker.nextElementSibling || marker.parentElement || marker;
          if (target) target.classList.add('ts-vf-focus');
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
          return;
        }
      }
      focusById(msg.vfId);
    }
    if (msg.type === 'clear-vf') clearFocus();
  });
})();
</script>
`;

  if (typeof html === "string" && html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }
  return `${html}\n${script}`;
}

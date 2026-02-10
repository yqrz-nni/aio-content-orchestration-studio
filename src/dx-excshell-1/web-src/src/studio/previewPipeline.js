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

export function resolvePreviewHtmlFromRenderResult(renderResult, fallbackHtml) {
  if (typeof renderResult?.renderedHtml === "string" && renderResult.renderedHtml.trim()) {
    return renderResult.renderedHtml;
  }

  const stitchedHtml = renderResult?.stitchedHtml ?? renderResult?.html ?? fallbackHtml ?? "";

  const resolvedPrb = resolveNamespaceByBindings({
    stitchedHtml,
    namespace: "prbProperties",
    aemBindingsEncountered: renderResult?.aemBindingsEncountered,
    aemPrefetchDataByStreamKey: renderResult?.aemPrefetchDataByStreamKey,
  });

  const resolvedCf = resolveNamespaceByBindings({
    stitchedHtml: resolvedPrb,
    namespace: "cf",
    aemBindingsEncountered: renderResult?.aemBindingsEncountered,
    aemPrefetchDataByStreamKey: renderResult?.aemPrefetchDataByStreamKey,
  });

  return resolvedCf || resolvedPrb || stitchedHtml || fallbackHtml || "";
}

export function stripAjoSyntax(html) {
  if (!html || typeof html !== "string") return html;

  let out = html;

  // Remove Liquid tags like {% let x = ... %}
  out = out.replace(/{%\s*[\s\S]*?\s*%}/g, "");

  // Strip ALL ACR marker blocks (everything from start marker to end marker)
  out = out.replace(/{{!--\s*\[acr-start[\s\S]*?--}}[\s\S]*?{{!--\s*\[acr-end[\s\S]*?--}}/gim, "");

  // Remove any stray marker comments
  out = out.replace(/{{!--\s*\[acr-(?:start|end)[^\]]*\]\s*--}}/gim, "");

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
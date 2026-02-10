// File: src/dx-excshell-1/web-src/src/screens/TemplateStudio.jsx

import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Heading,
  View,
  Grid,
  Flex,
  Button,
  Text,
  ListView,
  Item,
  Tabs,
  TabList,
  TabPanels,
  Divider,
  TextField,
  ComboBox,
  StatusLight,
} from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";
import { ImsContext } from "../context/ImsContext";

/* =============================================================================
 * Helpers: headers, HTML mutations, hydration (best-effort)
 * ============================================================================= */

function buildHeaders(ims) {
  return {
    Authorization: ims?.token?.startsWith("Bearer ") ? ims.token : `Bearer ${ims?.token}`,
    "x-gw-ims-org-id": ims?.org,
  };
}

function buildLabelsForPrb(prbNumber) {
  const labels = [];
  if (prbNumber) labels.push(`PRB:${prbNumber}`);
  return labels;
}

// Deterministic PRB replacement: replace any existing prbProperties AEM binding
function applyPrbToTemplateHtml(html, { prbCfId, repoId }) {
  if (!html) return html;

  const newCall = `{{fragment id='aem:${prbCfId}?repoId=${repoId}' result='prbProperties'}}`;

  const re = /{{\s*fragment\s+id=(['"])aem:[^'"]+\?repoId=[^'"]+\1\s+result=(['"])prbProperties\2\s*}}/g;

  if (!re.test(html)) {
    console.warn("Baseline HTML did not contain prbProperties binding; refusing to inject automatically.");
    return html;
  }

  return html.replace(re, newCall);
}

// v1 module insertion: append module block before the closing marker
function appendModuleToTemplateHtml(html, { vfId, aemCfId, repoId, vars = {} }) {
  const varAttrs = Object.entries(vars)
    .map(([k, v]) => `${k}='${String(v ?? "")}'`)
    .join(" ");

  const insertion = `
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="640">
      <tbody>
        <tr role="presentation">
          <th class="colspan1">
            <div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false">
              <div class="text-container" data-contenteditable="true">
                <p>{{fragment id='aem:${aemCfId}?repoId=${repoId}' result='cf' ${varAttrs} r1=r1 r2=r2 r3=r3 r4=r4 r5=r5 r6=r6 r7=r7 r8=r8 r9=r9 r10=r10}}</p>
              </div>
            </div>
            {{ fragment id="ajo:${vfId}" mode="inline" }}
          </th>
        </tr>
      </tbody>
    </table>
  </div>
  `;

  const marker = "</div></body></html>";
  if (html.includes(marker)) return html.replace(marker, `${insertion}${marker}`);
  return html + insertion;
}

/**
 * Hydrate state from an existing AJO template HTML.
 * Best-effort parsing:
 *  - PRB: result='prbProperties' binding => selectedPrbId
 *  - Modules: pairs (aem result='cf') with nearest subsequent (ajo fragment) in order
 */
function hydrateFromHtml(html) {
  const out = {
    prbCfId: null,
    modules: [], // [{ moduleId, vfId, contentId, vars }]
  };
  if (!html || typeof html !== "string") return out;

  // --- PRB ---
  {
    const prbRe = /{{\s*fragment\b[^}]*\bid=(['"])aem:([^'"]+)\1[^}]*\bresult=(['"])prbProperties\3[^}]*}}/i;
    const m = html.match(prbRe);
    if (m && m[2]) {
      const idPart = m[2].split("?")[0];
      out.prbCfId = idPart || null;
    }
  }

  // --- Gather all AEM CF bindings (result='cf') with index positions ---
  const cfBindings = [];
  {
    const re = /{{\s*fragment\b([^}]*)}}/gim;
    let m;
    while ((m = re.exec(html)) !== null) {
      const inside = m[1] || "";
      const idMatch = inside.match(/\bid\s*=\s*(['"])aem:([^'"]+)\1/i);
      const resultMatch = inside.match(/\bresult\s*=\s*(['"])([^'"]+)\1/i);
      if (!idMatch || !resultMatch) continue;

      const result = resultMatch[2];
      if (result !== "cf") continue;

      const raw = idMatch[2]; // "<ID>?repoId=..."
      const contentId = (raw.split("?")[0] || "").trim() || null;
      if (!contentId) continue;

      // parse simple vars (firstName etc) excluding r1..r10 and id/result
      const vars = {};
      const argRe = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:(['"])(.*?)\2|([^\s}]+))/g;
      let am;
      while ((am = argRe.exec(inside)) !== null) {
        const k = am[1];
        if (!k) continue;
        const lk = k.toLowerCase();
        if (lk === "id" || lk === "result") continue;
        if (/^r\d+$/.test(lk)) continue;

        const v = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
        vars[k] = v;
      }

      cfBindings.push({ start: m.index, end: re.lastIndex, contentId, vars });
    }
  }

  // --- Gather all AJO VF calls with index positions ---
  const vfCalls = [];
  {
    const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])(ajo:([^'"]+))\1[^}]*}}/gim;
    let m;
    while ((m = re.exec(html)) !== null) {
      vfCalls.push({ start: m.index, end: re.lastIndex, vfId: m[3] || null });
    }
  }

  // --- Pair each CF binding with the nearest subsequent VF call before the next CF binding ---
  for (let i = 0; i < cfBindings.length; i++) {
    const cf = cfBindings[i];
    const nextCfStart = i < cfBindings.length - 1 ? cfBindings[i + 1].start : Number.POSITIVE_INFINITY;

    const vf = vfCalls.find((v) => v.start >= cf.end && v.start < nextCfStart) || null;

    out.modules.push({
      moduleId: `hydr_${i}_${Date.now()}`,
      vfId: vf?.vfId || null,
      contentId: cf.contentId,
      vars: cf.vars || {},
    });
  }

  return out;
}

/* =============================================================================
 * Helpers: variable resolution for preview (namespace in binding order)
 * ============================================================================= */

function escapeHtml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function coerceValue(val) {
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

function getByPath(obj, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
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

function resolveNamespaceByBindings({ stitchedHtml, namespace, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
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

function resolvePreviewHtmlFromRenderResult(renderResult, fallbackHtml) {
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

/* =============================================================================
 * Helpers: JSON editor parsing for optional renderContext stream/cache
 * ============================================================================= */

function safeParseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function safeJson(obj, space = 2) {
  try {
    return JSON.stringify(obj, null, space);
  } catch {
    return String(obj);
  }
}

/* =============================================================================
 * Preview sanitizer + diagnostics
 * ============================================================================= */

/**
 * Strip *everything* between ACR start/end markers, regardless of type.
 * Also strip Liquid tags.
 *
 * IMPORTANT:
 * - This is for iframe preview only.
 * - It will remove your inline {{ fragment id="ajo:..." }} calls too (if they’re inside ACR markers),
 *   which is correct for “browser preview” unless your render action has already stitched the VF content.
 */
function stripAjoSyntax(html) {
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

function injectPreviewBridge(html, expectedVfIds = []) {
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

    // Generic VF presence check (even when you don’t know IDs)
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

function computePreviewWarnings({ canonicalHtml, bestHtml, sanitizedHtml, expectedVfIds = [] }) {
  const warnings = [];

  const canon = canonicalHtml || "";
  const best = bestHtml || "";
  const after = sanitizedHtml || "";

  const uniq = [...new Set((expectedVfIds || []).filter(Boolean))];

  for (const id of uniq) {
    const hasInCanonical =
      canon.includes(`ajo:${id}`) ||
      canon.includes(`data-fragment-id="ajo:${id}"`) ||
      canon.includes(`data-fragment-id='ajo:${id}'`);
    const hasInBest =
      best.includes(`ajo:${id}`) ||
      best.includes(`data-fragment-id="ajo:${id}"`) ||
      best.includes(`data-fragment-id='ajo:${id}'`);
    const hasInAfter =
      after.includes(`ajo:${id}`) ||
      after.includes(`data-fragment-id="ajo:${id}"`) ||
      after.includes(`data-fragment-id='ajo:${id}'`);

    if (hasInCanonical && !hasInBest) {
      warnings.push(
        `VF ajo:${id} is present in canonical AJO HTML, but missing from render result HTML (best). This points to the render action dropping/omitting it.`
      );
      continue;
    }

    if (hasInBest && !hasInAfter) {
      warnings.push(
        `VF ajo:${id} was present in render result HTML (best) but missing after sanitization. This points to the sanitizer stripping it.`
      );
      continue;
    }

    const hasDomMarker =
      after.includes(`data-fragment-id="ajo:${id}"`) || after.includes(`data-fragment-id='ajo:${id}'`);
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

function extractAllAjoVfIdsFromHtml(html) {
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

/* =============================================================================
 * Component
 * ============================================================================= */

export function TemplateStudio() {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  // TODO: make repoId dynamic from env/selection
  const repoId = "author-p131724-e1294209.adobeaemcloud.com";

  const [canonicalHtml, setCanonicalHtml] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");

  const [lastRenderResult, setLastRenderResult] = useState(null);

  const [templateId, setTemplateId] = useState(null);
  const [templateName, setTemplateName] = useState("Baseline Clone");

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrbId, setSelectedPrbId] = useState(null);
  const [selectedPrb, setSelectedPrb] = useState(null);

  const [vfItems, setVfItems] = useState([]);
  const [contentOptions, setContentOptions] = useState([]);

  const [selectedVfId, setSelectedVfId] = useState(null);
  const [selectedContentId, setSelectedContentId] = useState(null);

  const [modules, setModules] = useState([]);

  const [isUpdatingPrb, setIsUpdatingPrb] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const [renderError, setRenderError] = useState("");
  const [previewWarnings, setPreviewWarnings] = useState([]);

  // iframe runtime messages
  const [iframeMsgs, setIframeMsgs] = useState([]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bindingStreamText, setBindingStreamText] = useState("[]");
  const [cacheText, setCacheText] = useState("{}");

  const bindingStream = useMemo(() => {
    const v = safeParseJson(bindingStreamText, []);
    return Array.isArray(v) ? v : [];
  }, [bindingStreamText]);

  const cache = useMemo(() => {
    const v = safeParseJson(cacheText, {});
    return v && typeof v === "object" ? v : {};
  }, [cacheText]);

  // IMPORTANT CHANGE:
  // Track ALL AJO VFs present in canonical HTML (including “standalone” VFs like footer),
  // not just those inferred from modules[].
  const expectedVfIds = useMemo(() => {
    const fromModules = [];
    for (const m of Array.isArray(modules) ? modules : []) if (m?.vfId) fromModules.push(m.vfId);

    const fromCanonical = extractAllAjoVfIdsFromHtml(canonicalHtml);

    return [...new Set([...fromModules, ...fromCanonical])];
  }, [modules, canonicalHtml]);

  // ---------------------------------------------------------------------------
  // VF survival diagnostics (canonical → render result → sanitizer)
  // ---------------------------------------------------------------------------

  const [vfDiag, setVfDiag] = useState({
    expected: [],
    best: [],
    sanitized: [],
  });

  const vfDiagSummary = useMemo(() => {
    const expected = Array.isArray(vfDiag.expected) ? vfDiag.expected : [];
    const best = Array.isArray(vfDiag.best) ? vfDiag.best : [];
    const sanitized = Array.isArray(vfDiag.sanitized) ? vfDiag.sanitized : [];

    const missingInBest = expected.filter((id) => !best.includes(id));
    const missingAfterSanitize = best.filter((id) => !sanitized.includes(id));

    return {
      expectedCount: expected.length,
      bestCount: best.length,
      sanitizedCount: sanitized.length,
      missingInBest,
      missingAfterSanitize,
    };
  }, [vfDiag]);

  // ---------------------------------------------------------------------------
  // Operation queue
  // ---------------------------------------------------------------------------

  const opQueueRef = useRef(Promise.resolve());
  function enqueue(asyncFn) {
    opQueueRef.current = opQueueRef.current
      .then(() => asyncFn())
      .catch((e) => console.error("Queued op failed:", e));
    return opQueueRef.current;
  }

  // ---------------------------------------------------------------------------
  // Iframe message listener (bridge)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onMessage(ev) {
      const msg = ev?.data;
      if (!msg || msg.__TS_PREVIEW__ !== true) return;

      setIframeMsgs((prev) => {
        const next = [...prev, { at: new Date().toISOString(), ...msg }];
        return next.slice(-80);
      });

      if (msg.type === "error" || msg.type === "unhandledrejection") {
        const m = msg?.data?.message || msg.type;
        setRenderError((cur) => cur || `Preview iframe error: ${m}`);
      }

      if (msg.type === "vf-dom-check") {
        const found = msg?.data?.found || {};
        const missing = Object.entries(found)
          .filter(([_id, ok]) => !ok)
          .map(([id]) => id);

        if (missing.length) {
          setPreviewWarnings((cur) => {
            const add = [`Iframe DOM check: missing rendered VF DOM for ${missing.map((x) => `ajo:${x}`).join(", ")}.`];
            const merged = [...add, ...(Array.isArray(cur) ? cur : [])];
            return [...new Set(merged)].slice(0, 12);
          });
        }
      }

      if (msg.type === "vf-dom-any") {
        const count = Number(msg?.data?.count || 0);
        if (!Number.isNaN(count) && count === 0) {
          setPreviewWarnings((cur) => {
            const add = [
              "Iframe DOM check: no elements found with data-fragment-id starting with 'ajo:'. This typically means your render action is not stitching VF HTML before preview.",
            ];
            return [...new Set([...(Array.isArray(cur) ? cur : []), ...add])].slice(0, 12);
          });
        }
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function createTemplateFromBaseline() {
    try {
      const res = await actionWebInvoke(actions["ajo-template-create"], headers, {
        name: templateName,
        description: "Created from baseline via App Builder",
        createFromBaseline: true,
        prbNumber: selectedPrb?.raw?.prbNumber || null,
        prbName: selectedPrb?.raw?.name || null,
      });

      const id = res?.templateId;
      setTemplateId(id);

      if (!id) {
        console.warn("Template created but no templateId returned:", res);
        return;
      }

      const getRes = await actionWebInvoke(actions["ajo-template-get"], headers, { templateId: id });
      const html = getRes?.htmlBody;
      if (!html) {
        console.warn("Template fetched but no htmlBody found:", getRes);
        return;
      }

      const hydrated = hydrateFromHtml(html);
      setCanonicalHtml(html);

      if (hydrated?.prbCfId) {
        setSelectedPrbId(hydrated.prbCfId);
        const prbObj = prbOptions.find((o) => o.id === hydrated.prbCfId) || null;
        setSelectedPrb(prbObj);
      }

      setModules(Array.isArray(hydrated?.modules) ? hydrated.modules : []);
    } catch (e) {
      console.error("Create-from-baseline failed:", e);
    }
  }

  async function loadVfs() {
    const res = await actionWebInvoke(actions["ajo-vf-demo"], headers);
    setVfItems(res?.fragments || []);
  }

  async function loadPrbList() {
    const res = await actionWebInvoke(actions["aem-prb-list"]);
    const items = res?.data?.prbPropertiesList?.items || [];

    setPrbOptions(
      items.map((it) => {
        const displayName = it.name || it.prbNumber || it._path || it._id;
        return {
          id: it._id,
          label: it.prbNumber && it.name ? `${it.prbNumber} — ${it.name}` : displayName,
          path: it._path,
          raw: it,
        };
      })
    );
  }

  async function loadContentList() {
    try {
      const res = await actionWebInvoke(actions["aem-gql-demo"]);
      const items = res?.data?.unifiedPromotionalContentList?.items || [];

      setContentOptions(
        items.map((it) => ({
          id: it._id,
          label: it.headlineText || it._path || it._id,
          path: it._path,
        }))
      );
    } catch (e) {
      console.error("Load Content CFs failed:", e);
    }
  }

  async function setPrb(prbId) {
    if (isUpdatingPrb) return;

    setSelectedPrbId(prbId);
    const prbObj = prbOptions.find((o) => o.id === prbId) || null;
    setSelectedPrb(prbObj);

    if (!templateId || !prbObj || !canonicalHtml) return;

    await enqueue(async () => {
      try {
        setIsUpdatingPrb(true);

        const prbNumber = prbObj?.raw?.prbNumber;

        const nextHtml = applyPrbToTemplateHtml(canonicalHtml, {
          prbCfId: prbObj.id,
          repoId,
        });

        setCanonicalHtml(nextHtml);

        await actionWebInvoke(actions["ajo-template-update"], headers, {
          templateId,
          name: prbNumber ? `${prbNumber} — ${templateName}` : templateName,
          labels: buildLabelsForPrb(prbNumber),
          html: nextHtml,
        });
      } catch (e) {
        console.error("PRB update failed:", e);
      } finally {
        setIsUpdatingPrb(false);
      }
    });
  }

  function addModule() {
    if (!templateId) return;
    if (!selectedVfId || !selectedContentId) return;
    if (!canonicalHtml) return;

    enqueue(async () => {
      const moduleId = `m_${Date.now()}`;
      const nextModules = [
        ...modules,
        {
          moduleId,
          vfId: selectedVfId,
          contentId: selectedContentId,
          vars: { firstName: "" },
        },
      ];
      setModules(nextModules);

      const nextHtml = appendModuleToTemplateHtml(canonicalHtml, {
        vfId: selectedVfId,
        aemCfId: selectedContentId,
        repoId,
        vars: { firstName: "" },
      });

      setCanonicalHtml(nextHtml);
    });
  }

  async function renderPreview() {
    try {
      setRenderError("");
      setPreviewWarnings([]);
      setIframeMsgs([]);
      setIsRendering(true);

      if (!canonicalHtml) {
        setPreviewHtml("<html><body><p>No HTML loaded yet.</p></body></html>");
        return;
      }

      const renderContext = {
        prb: {
          id: selectedPrb?.id,
          cfId: selectedPrb?.id,
          prbNumber: selectedPrb?.raw?.prbNumber,
          name: selectedPrb?.raw?.name,
        },
        repoId,
        bindingStream,
        cache,
      };

      const res = await actionWebInvoke(actions["ajo-template-render"], headers, {
        html: canonicalHtml,
        renderContext,
      });

      setLastRenderResult(res || null);

      const best = resolvePreviewHtmlFromRenderResult(res, canonicalHtml);
      if (!best || typeof best !== "string") {
        setPreviewHtml("<html><body><p>Render succeeded but returned no HTML.</p></body></html>");
        return;
      }

      // Preview is browser-based, so we strip ACR blocks + Liquid noise.
      const sanitized = stripAjoSyntax(best);

      // VF survival diagnostics
      setVfDiag({
        expected: extractAllAjoVfIdsFromHtml(canonicalHtml),
        best: extractAllAjoVfIdsFromHtml(best),
        sanitized: extractAllAjoVfIdsFromHtml(sanitized),
      });

      // Pre-iframe diagnostics
      const warnings = computePreviewWarnings({
        canonicalHtml,
        bestHtml: best,
        sanitizedHtml: sanitized,
        expectedVfIds,
      });
      if (warnings.length) {
        console.warn("Preview warnings:", warnings);
        setPreviewWarnings(warnings);
      }

      // Inject iframe bridge script (runtime DOM + error signals)
      const bridged = injectPreviewBridge(sanitized, expectedVfIds);

      setPreviewHtml(bridged);

      // Optional: merge hydrated values into cache editor for reuse
      if (res?.aemCacheKeys && res?.aemPrefetchDataByStreamKey && Array.isArray(res?.aemBindingsEncountered)) {
        const keys = res.aemCacheKeys || [];
        const byStreamKey = res.aemPrefetchDataByStreamKey || {};
        const encountered = res.aemBindingsEncountered || [];

        const nextCache = { ...(cache || {}) };

        for (const b of encountered) {
          const model =
            b?.result === "cf" ? "unifiedPromotionalContent" : b?.result === "prbProperties" ? "prbProperties" : null;
          if (!model || !b?.aemId) continue;

          const ck = `${model}:${b.aemId}`;
          if (!keys.includes(ck)) continue;

          const sk = `${b.index}:${b.result}`;
          const item = byStreamKey?.[sk];
          if (item && typeof item === "object") nextCache[ck] = item;
        }

        setCacheText(safeJson(nextCache, 2));
      }
    } catch (e) {
      console.error("Render preview failed:", e);
      setRenderError(e?.message || "Render failed");
      setPreviewWarnings([]);
      setPreviewHtml(stripAjoSyntax(canonicalHtml || "<html><body><p>Render failed.</p></body></html>"));
    } finally {
      setIsRendering(false);
    }
  }

  // Auto-refresh preview when canonical HTML changes (slight debounce)
  useEffect(() => {
    if (!canonicalHtml) return;

    const t = setTimeout(() => {
      renderPreview();
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalHtml]);

  // If PRB options load after we already have selectedPrbId, resolve selectedPrb object
  useEffect(() => {
    if (!selectedPrbId || selectedPrb) return;
    const prbObj = prbOptions.find((o) => o.id === selectedPrbId) || null;
    if (prbObj) setSelectedPrb(prbObj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prbOptions]);

  const prbStatus = selectedPrbId ? "configured" : "missing";

  const aemWarnings = Array.isArray(lastRenderResult?.aemWarnings) ? lastRenderResult.aemWarnings : [];
  const resolutionWarnings = Array.isArray(lastRenderResult?.resolutionWarnings)
    ? lastRenderResult.resolutionWarnings
    : [];
  const aemPrefetch = Array.isArray(lastRenderResult?.aemPrefetch) ? lastRenderResult.aemPrefetch : [];
  const perf = lastRenderResult?.perf || null;

  return (
    <View>
      <Heading level={2}>Template Studio</Heading>

      {/* Global config bar */}
      <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
        <Flex gap="size-200" alignItems="end" wrap>
          <TextField label="Template name" value={templateName} onChange={setTemplateName} width="size-3600" />
          <Button variant="cta" onPress={createTemplateFromBaseline}>
            Create from baseline
          </Button>

          <Divider orientation="vertical" size="S" />

          <Flex direction="column" gap="size-50">
            <Text>Global configuration</Text>
            <Flex gap="size-200" alignItems="center">
              <ComboBox
                label="PRB Properties (global)"
                placeholder="Paste/type PRB number…"
                selectedKey={selectedPrbId}
                onSelectionChange={(key) => setPrb(key)}
                width="size-3600"
                menuTrigger="focus"
              >
                {prbOptions.map((o) => (
                  <Item key={o.id}>{o.label}</Item>
                ))}
              </ComboBox>
              <Button variant="secondary" onPress={loadPrbList}>
                Load PRBs
              </Button>

              {prbStatus === "configured" ? (
                <StatusLight variant="positive">PRB set</StatusLight>
              ) : (
                <StatusLight variant="negative">PRB missing</StatusLight>
              )}
            </Flex>
          </Flex>

          <Divider orientation="vertical" size="S" />

          <Flex gap="size-200" alignItems="end">
            <Button variant="secondary" onPress={loadVfs}>
              Load VFs
            </Button>
            <Button variant="secondary" onPress={loadContentList}>
              Load Content CFs
            </Button>
            <Button variant="primary" onPress={renderPreview} isDisabled={!canonicalHtml || isRendering}>
              {isRendering ? "Rendering…" : "Render preview"}
            </Button>
          </Flex>

          <Divider orientation="vertical" size="S" />

          <Button variant="secondary" onPress={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </Button>
        </Flex>

        <View marginTop="size-150">
          <Text>templateId: {templateId || "(not created yet)"}</Text>
        </View>

        {aemWarnings.length ? (
          <View marginTop="size-150">
            <StatusLight variant="negative">{aemWarnings[0]}</StatusLight>
          </View>
        ) : null}

        {showAdvanced ? (
          <View marginTop="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-200">
            <Heading level={4}>Advanced renderContext (optional)</Heading>
            <Text UNSAFE_style={{ opacity: 0.8 }}>
              These are passed to the render action under <code>renderContext.bindingStream</code> and{" "}
              <code>renderContext.cache</code>. If you leave them empty, the action will hydrate normally.
            </Text>

            <Divider size="S" marginY="size-150" />

            <Grid columns={["1fr", "1fr"]} gap="size-200">
              <View>
                <Heading level={5}>bindingStream</Heading>
                <TextField
                  aria-label="bindingStream"
                  value={bindingStreamText}
                  onChange={setBindingStreamText}
                  isMultiline
                  height="size-3000"
                  width="100%"
                />
              </View>
              <View>
                <Heading level={5}>cache</Heading>
                <TextField
                  aria-label="cache"
                  value={cacheText}
                  onChange={setCacheText}
                  isMultiline
                  height="size-3000"
                  width="100%"
                />
              </View>
            </Grid>
          </View>
        ) : null}
      </View>

      <Divider size="S" marginY="size-200" />

      {/* Main grid */}
      <Grid columns={["1fr", "2fr", "1fr"]} gap="size-200" height="78vh">
        {/* Left: VFs */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Visual Fragments</Heading>
            <Text>{vfItems.length ? `${vfItems.length}` : ""}</Text>
          </Flex>

          <ListView
            aria-label="VFs"
            selectionMode="single"
            selectedKeys={selectedVfId ? [selectedVfId] : []}
            onSelectionChange={(keys) => setSelectedVfId([...keys][0])}
            height="70vh"
          >
            {vfItems.map((vf) => (
              <Item key={vf.id}>{vf.name}</Item>
            ))}
          </ListView>
        </View>

        {/* Center: Canvas + Preview */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Canvas</Heading>
            <Button variant="cta" onPress={addModule} isDisabled={!templateId || !selectedVfId || !selectedContentId}>
              Add module
            </Button>
          </Flex>

          <Text marginTop="size-100" UNSAFE_style={{ opacity: 0.8 }}>
            Tip: PRB is global; Content CF is per-module. Modules are tracked separately from HTML (better for
            reorder/replace later).
          </Text>

          <Divider size="S" marginY="size-200" />

          <Tabs aria-label="Canvas Tabs">
            <TabList>
              <Item key="preview">Preview</Item>
              <Item key="modules">Modules</Item>
              <Item key="html">AJO HTML</Item>
              <Item key="aem">AEM</Item>
            </TabList>
            <TabPanels>
              <Item key="preview">
                <View borderWidth="thin" borderColor="light" borderRadius="small" height="62vh" padding="size-100">
                  {renderError ? (
                    <View marginBottom="size-100">
                      <StatusLight variant="negative">{renderError}</StatusLight>
                    </View>
                  ) : null}

                  {!renderError && previewWarnings.length ? (
                    <View marginBottom="size-100">
                      {previewWarnings.map((w, i) => (
                        <View key={`pw-${i}`} marginBottom="size-50">
                          <StatusLight variant="negative">{w}</StatusLight>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {iframeMsgs.length ? (
                    <View marginBottom="size-100">
                      <Heading level={5}>Preview iframe messages</Heading>
                      <Divider size="S" marginY="size-100" />
                      {iframeMsgs.slice(-8).map((m, i) => (
                        <View key={`im-${i}`} marginBottom="size-50">
                          <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                            {m.at} — {m.type}: {safeJson(m.data, 0)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* VF survival diagnostics */}
                  <View
                    marginBottom="size-100"
                    borderWidth="thin"
                    borderColor="light"
                    borderRadius="small"
                    padding="size-100"
                  >
                    <Heading level={5}>VF survival diagnostics</Heading>

                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      expected(from canonical)={vfDiagSummary.expectedCount} • best(after render)={vfDiagSummary.bestCount} •
                      sanitized(after strip)={vfDiagSummary.sanitizedCount}
                    </Text>

                    {vfDiagSummary.missingInBest.length ? (
                      <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                        missing in best: {vfDiagSummary.missingInBest.map((id) => `ajo:${id}`).join(", ")}
                      </Text>
                    ) : null}

                    {vfDiagSummary.missingAfterSanitize.length ? (
                      <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                        missing after sanitize: {vfDiagSummary.missingAfterSanitize.map((id) => `ajo:${id}`).join(", ")}
                      </Text>
                    ) : null}

                    <Divider size="S" marginY="size-100" />

                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      expected: {safeJson(vfDiag.expected, 0)}
                    </Text>
                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      best: {safeJson(vfDiag.best, 0)}
                    </Text>
                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      sanitized: {safeJson(vfDiag.sanitized, 0)}
                    </Text>
                  </View>

                  <iframe
                    title="Email Preview"
                    style={{ width: "100%", height: "100%", border: "none" }}
                    sandbox="allow-same-origin allow-scripts"
                    srcDoc={previewHtml}
                  />
                </View>
              </Item>

              <Item key="modules">
                <View height="62vh" overflow="auto">
                  {modules.length === 0 ? (
                    <Text>No modules yet.</Text>
                  ) : (
                    modules.map((m, idx) => (
                      <View key={m.moduleId} marginBottom="size-150">
                        <Text>
                          {idx + 1}. VF: {m.vfId || "(not paired)"} | CF: {m.contentId}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </Item>

              <Item key="html">
                <View
                  borderWidth="thin"
                  borderColor="light"
                  borderRadius="small"
                  padding="size-200"
                  height="62vh"
                  overflow="auto"
                >
                  <pre style={{ whiteSpace: "pre-wrap" }}>{canonicalHtml || "(empty)"}</pre>
                </View>
              </Item>

              <Item key="aem">
                <View height="62vh" overflow="auto">
                  <View marginBottom="size-150">
                    <Heading level={5}>Render diagnostics</Heading>
                    {perf ? (
                      <Text UNSAFE_style={{ opacity: 0.85 }}>
                        streamHits={perf.streamHits}, cacheHits={perf.cacheHits}, hydrated={perf.hydratedCount}, totalBindings=
                        {perf.totalBindings}
                      </Text>
                    ) : (
                      <Text UNSAFE_style={{ opacity: 0.85 }}>No perf yet. Render preview to populate.</Text>
                    )}
                  </View>

                  {resolutionWarnings.length || aemWarnings.length ? (
                    <View marginBottom="size-150">
                      <Heading level={5}>Warnings</Heading>
                      <Divider size="S" marginY="size-100" />
                      {[...resolutionWarnings, ...aemWarnings].slice(0, 20).map((w, i) => (
                        <View key={`w-${i}`} marginBottom="size-50">
                          <StatusLight variant="negative">{w}</StatusLight>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {!aemPrefetch.length ? (
                    <Text>No AEM prefetch rows yet. Render preview to populate.</Text>
                  ) : (
                    <View>
                      <Heading level={5}>AEM Prefetch</Heading>
                      <Divider size="S" marginY="size-100" />
                      {aemPrefetch.map((p, i) => (
                        <View key={`${p.index}:${p.result}:${i}`} marginBottom="size-100">
                          <Text>
                            {p.ok ? "✅" : "❌"} {p.index}:{p.result} → {p.model} ({p.aemId}){" "}
                            {!p.ok ? `— ${p.reason || ""}` : `— ${p.source || ""}`}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {lastRenderResult ? (
                    <View marginTop="size-200">
                      <Heading level={5}>Raw render result</Heading>
                      <Divider size="S" marginY="size-100" />
                      <View
                        borderWidth="thin"
                        borderColor="light"
                        borderRadius="small"
                        padding="size-200"
                        overflow="auto"
                        height="size-2400"
                      >
                        <pre style={{ whiteSpace: "pre-wrap" }}>{safeJson(lastRenderResult, 2)}</pre>
                      </View>
                    </View>
                  ) : null}
                </View>
              </Item>
            </TabPanels>
          </Tabs>
        </View>

        {/* Right: Content CFs */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Content Fragments</Heading>
            <Text>{contentOptions.length ? `${contentOptions.length}` : ""}</Text>
          </Flex>

          <ListView
            aria-label="Content CFs"
            selectionMode="single"
            selectedKeys={selectedContentId ? [selectedContentId] : []}
            onSelectionChange={(keys) => setSelectedContentId([...keys][0])}
            height="70vh"
          >
            {contentOptions.map((cf) => (
              <Item key={cf.id}>{cf.label}</Item>
            ))}
          </ListView>
        </View>
      </Grid>
    </View>
  );
}
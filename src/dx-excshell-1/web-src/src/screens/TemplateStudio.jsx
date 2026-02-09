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

  const re =
    /{{\s*fragment\s+id=(['"])aem:[^'"]+\?repoId=[^'"]+\1\s+result=(['"])prbProperties\2\s*}}/g;

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
 * Notes:
 *  - You reuse "cf" namespace repeatedly; that’s fine. Hydration uses appearance order.
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
    // ImageRef-like
    if (typeof val._path === "string") return val._path;

    // Some refs can be shaped like { _path: { _path: "..." } }
    if (val._path && typeof val._path === "object" && typeof val._path._path === "string") return val._path._path;

    // MultiFormatString-like
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

/**
 * Resolve a namespace by binding order:
 * Every time we encounter the next AEM binding tag for that namespace, we swap the context
 * to the hydrated object for that specific binding ("${index}:${result}").
 */
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

    out += tag; // keep tag (harmless in iframe)

    cursor = tagPos + tag.length;

    const streamKey = `${b.index}:${b.result}`;
    currentCtx = aemPrefetchDataByStreamKey?.[streamKey] ?? null;
  }

  out += replaceNamespaceVars(stitchedHtml.slice(cursor), namespace, currentCtx);
  return out;
}

function resolvePreviewHtmlFromRenderResult(renderResult, fallbackHtml) {
  // Prefer renderedHtml produced by the action (it resolves prbProperties.* + cf.* in binding order)
  if (typeof renderResult?.renderedHtml === "string" && renderResult.renderedHtml.trim()) {
    return renderResult.renderedHtml;
  }

  const stitchedHtml = renderResult?.stitchedHtml ?? renderResult?.html ?? fallbackHtml ?? "";

  // Fallback: resolve prbProperties then cf using binding order (same order as action)
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

/**
 * Optional preview-only sanitizer (belt + suspenders).
 * If the action returns renderedHtml sanitized, this is mostly redundant.
 * It also protects the fallback path (stitchedHtml + local resolution).
 */
function stripAjoSyntax(html) {
  if (!html || typeof html !== "string") return html;
  let out = html;

  // 1) Remove ACR wrapped blocks:
  // {{!-- [acr-start ... }}   ...anything...   {{!-- ... [acr-end ... }}
  // - non-greedy, across newlines
  // - keeps everything else (including {{cf.*}} tokens)
  const acrBlockRe =
    /{{!--\s*\[acr-start[\s\S]*?}}[\s\S]*?{{!--[\s\S]*?\[acr-end[\s\S]*?}}/gim;

  out = out.replace(acrBlockRe, "");

  // 2) Remove Liquid tags: {% ... %}
  const liquidTagRe = /{%\s*[\s\S]*?\s*%}/g;
  out = out.replace(liquidTagRe, "");

  return out;
}

/* =============================================================================
 * Component
 * ============================================================================= */

export function TemplateStudio() {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  // TODO: make repoId dynamic from env/selection
  const repoId = "author-p131724-e1294209.adobeaemcloud.com";

  // ---------------------------------------------------------------------------
  // Source of truth: canonical HTML + editor state
  // ---------------------------------------------------------------------------

  // canonicalHtml: what you would PUT back to AJO
  const [canonicalHtml, setCanonicalHtml] = useState("");

  // previewHtml: what you show in iframe (renderedHtml preferred, then stitched + vars resolved)
  const [previewHtml, setPreviewHtml] = useState("");

  // Keep last render payload for debugging / AEM prefetch visibility
  const [lastRenderResult, setLastRenderResult] = useState(null);

  // Template session identity
  const [templateId, setTemplateId] = useState(null);
  const [templateName, setTemplateName] = useState("Baseline Clone");

  // Global context (PRB)
  const [prbOptions, setPrbOptions] = useState([]); // [{id,label,path,raw}]
  const [selectedPrbId, setSelectedPrbId] = useState(null);
  const [selectedPrb, setSelectedPrb] = useState(null);

  // Libraries
  const [vfItems, setVfItems] = useState([]); // [{id,name}]
  const [contentOptions, setContentOptions] = useState([]); // [{id,label,path}]

  // Canvas / editor selections
  const [selectedVfId, setSelectedVfId] = useState(null);
  const [selectedContentId, setSelectedContentId] = useState(null);

  // Canvas module list (separate from HTML)
  const [modules, setModules] = useState([]); // [{moduleId, vfId, contentId, vars}]

  // UI flags
  const [isUpdatingPrb, setIsUpdatingPrb] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState("");

  // Optional advanced renderContext controls (don’t change your normal workflow)
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

  // ---------------------------------------------------------------------------
  // Simple “operation queue” so rapid clicks don’t interleave PUT-like updates
  // ---------------------------------------------------------------------------

  const opQueueRef = useRef(Promise.resolve());
  function enqueue(asyncFn) {
    opQueueRef.current = opQueueRef.current
      .then(() => asyncFn())
      .catch((e) => console.error("Queued op failed:", e));
    return opQueueRef.current;
  }

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

      // Immediately fetch canonical HTML from AJO
      const getRes = await actionWebInvoke(actions["ajo-template-get"], headers, {
        templateId: id,
      });

      const html = getRes?.htmlBody;
      if (!html) {
        console.warn("Template fetched but no htmlBody found:", getRes);
        return;
      }

      // Hydrate editor state from baseline HTML (PRB binding + modules if any)
      const hydrated = hydrateFromHtml(html);
      setCanonicalHtml(html);

      if (hydrated?.prbCfId) {
        setSelectedPrbId(hydrated.prbCfId);
        const prbObj = prbOptions.find((o) => o.id === hydrated.prbCfId) || null;
        setSelectedPrb(prbObj);
      }

      if (Array.isArray(hydrated?.modules) && hydrated.modules.length) {
        setModules(hydrated.modules);
      } else {
        setModules([]);
      }
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

  // ✅ FIXED: only one setPrb, and it’s concurrency-safe
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
          vars: { firstName: "" }, // example var; you can expand later
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

      // If you want module adds to persist immediately, uncomment:
      // await actionWebInvoke(actions["ajo-template-update"], headers, { templateId, html: nextHtml, name: templateName });
    });
  }

  /**
   * Render preview:
   * - Uses ajo-template-render action to resolve nested AJO fragments + prefetch AEM bindings.
   * - Prefer action's renderedHtml; fallback to stitchedHtml + local namespace resolution.
   * - Optional: pass bindingStream/cache through renderContext for reuse/hydration skipping.
   */
  async function renderPreview() {
    try {
      setRenderError("");
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

        // advanced (optional)
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

      // ✅ sanitize preview output (action should already sanitize renderedHtml, but this protects fallback path)
      setPreviewHtml(stripAjoSyntax(best));

      // Optional: if action returns cache keys and hydrated stream objects, you can merge into cache editor.
      // This is safe and purely a UX improvement; it does not affect canonicalHtml.
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

      // ✅ Fallback: still show *something* useful
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

  // ✅ Only declare prbStatus once
  const prbStatus = selectedPrbId ? "configured" : "missing";

  // Optional: show AEM warnings in UI (from last render)
  const aemWarnings = Array.isArray(lastRenderResult?.aemWarnings) ? lastRenderResult.aemWarnings : [];
  const resolutionWarnings = Array.isArray(lastRenderResult?.resolutionWarnings) ? lastRenderResult.resolutionWarnings : [];
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

        {/* Optional debugging */}
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
                  <iframe
                    title="Email Preview"
                    style={{ width: "100%", height: "100%", border: "none" }}
                    sandbox="allow-same-origin"
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
                  {/* Summary */}
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

                  {/* Warnings */}
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

                  {/* Prefetch rows */}
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

                  {/* Raw render result (collapsed-ish) */}
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
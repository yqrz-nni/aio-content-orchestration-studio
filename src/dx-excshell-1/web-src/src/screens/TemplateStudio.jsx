// File: src/dx-excshell-1/web-src/src/screens/TemplateStudio.jsx

import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Heading,
  View,
  Grid,
  Flex,
  Button,
  Text,
  Tabs,
  TabList,
  TabPanels,
  Divider,
  TextField,
  ComboBox,
  StatusLight,
  Switch,
  DialogTrigger,
  Item,
} from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";
import { ImsContext } from "../context/ImsContext";

import {
  applyPrbToTemplateHtml,
  appendPatternOnlyToTemplateHtml,
  bindContentInModuleHtml,
  hydrateFromHtml,
  insertPatternBeforeModuleHtml,
  moveModuleInTemplateHtml,
  removeModuleFromTemplateHtml,
  stripTsModuleMarkers,
} from "../studio/templateEngine";

import {
  stripAjoSyntax,
  injectPreviewBridge,
  injectPreviewMarkers,
  injectPreviewFocusBridge,
  computePreviewWarnings,
  extractAllAjoVfIdsFromHtml,
  resolvePreviewHtmlFromRenderResult,
} from "../studio/previewPipeline";

import { PatternPickerDialog } from "../studio/components/PatternPickerDialog";
import { ModuleCard } from "../studio/components/ModuleCard";

/* =============================================================================
 * Helpers: headers + labels
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

function extractModuleSkeletonHints(html) {
  if (!html || typeof html !== "string") return [];
  const out = [];
  const re = /<!--\s*ts:module id="([^"]+)"\s*-->([\s\S]*?)<!--\s*ts:module-end id="\1"\s*-->/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const moduleId = match[1];
    const block = match[2] || "";
    const imageCount = (block.match(/<img\b/gi) || []).length;
    const textCount = (block.match(/data-tmp-component-id=["']text["']/gi) || []).length;
    out.push({
      moduleId,
      hasImage: imageCount > 0,
      textWeight: Math.max(2, Math.min(5, textCount || 3)),
    });
  }
  return out;
}

function normalizeVfId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  return s.toLowerCase().startsWith("ajo:") ? s.slice(4) : s;
}

function hasDynamicReferenceTokens(content) {
  if (!content || typeof content !== "object") return false;

  const refs = Array.isArray(content.references) ? content.references : [];
  if (refs.length > 0) return true;

  const body = Array.isArray(content.bodyCopy) ? content.bodyCopy : [];
  return body.some((row) => {
    const html = typeof row?.html === "string" ? row.html : "";
    const plaintext = typeof row?.plaintext === "string" ? row.plaintext : "";
    return /{{\s*r\d+\s*}}/i.test(html) || /{{\s*r\d+\s*}}/i.test(plaintext);
  });
}

export function TemplateStudio({ mode = "route", prbIdOverride, templateIdOverride }) {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  const nav = useNavigate();
  const params = useParams();
  const prbId = mode === "embedded" ? prbIdOverride : params.prbId;
  const templateId = mode === "embedded" ? templateIdOverride : params.templateId;
  const [searchParams] = useSearchParams();
  const [focusDebug, setFocusDebug] = useState(() => {
    try {
      return window.localStorage.getItem("ts_focus_debug") === "1";
    } catch {
      return false;
    }
  });
  const focusDebugFromUrl = searchParams.get("focusdebug") === "1";

  // TODO: make repoId dynamic from env/selection
  const repoId = "author-p131724-e1294209.adobeaemcloud.com";

  const [canonicalHtml, setCanonicalHtml] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const iframeRef = useRef(null);
  const previewScrollRef = useRef(0);

  const [lastRenderResult, setLastRenderResult] = useState(null);
  const [lastBestHtml, setLastBestHtml] = useState("");
  const [lastSanitizedHtml, setLastSanitizedHtml] = useState("");

  const [templateName, setTemplateName] = useState("Baseline Clone");

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrbId, setSelectedPrbId] = useState(prbId || null);
  const [selectedPrb, setSelectedPrb] = useState(null);

  const [vfItems, setVfItems] = useState([]);
  const [vfDebugSample, setVfDebugSample] = useState(null);
  const [contentOptions, setContentOptions] = useState([]);
  const [vfAutoInsertConfig, setVfAutoInsertConfig] = useState({
    compiledReferencesTagId: null,
    footerTagId: null,
    compiledReferencesDefaultVfId: null,
  });

  const [modules, setModules] = useState([]);
  const modulesRef = useRef([]);
  const [hoveredModule, setHoveredModule] = useState(null);
  const [pinnedModule, setPinnedModule] = useState(null);
  const compositionRef = useRef(null);
  const compositionListRef = useRef(null);
  const [pendingScrollModuleId, setPendingScrollModuleId] = useState(null);
  const [pendingFocusModule, setPendingFocusModule] = useState(null);

  const [isUpdatingPrb, setIsUpdatingPrb] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const [renderError, setRenderError] = useState("");
  const [previewWarnings, setPreviewWarnings] = useState([]);
  const [autoPatternToast, setAutoPatternToast] = useState("");
  const autoPatternToastTimerRef = useRef(null);
  const canonicalHtmlRef = useRef("");
  const pendingAutoRefVfInsertRef = useRef(null);

  const [iframeMsgs, setIframeMsgs] = useState([]);

  // Kept for backwards-compat with your advanced renderContext inputs (we’ll keep hidden by default)
  const [bindingStreamText, setBindingStreamText] = useState("[]");
  const [cacheText, setCacheText] = useState("{}");

  // Diagnostics gating
  const [enableIframeBridge, setEnableIframeBridge] = useState(searchParams.get("bridge") === "1");

  // Tabs (preview-side)
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "preview");
  const enableDiagnostics = activeTab === "diagnostics";

  const bindingStream = useMemo(() => {
    const v = safeParseJson(bindingStreamText, []);
    return Array.isArray(v) ? v : [];
  }, [bindingStreamText]);

  const cache = useMemo(() => {
    const v = safeParseJson(cacheText, {});
    return v && typeof v === "object" ? v : {};
  }, [cacheText]);

  const expectedVfIds = useMemo(() => {
    const fromModules = [];
    for (const m of Array.isArray(modules) ? modules : []) if (m?.vfId) fromModules.push(m.vfId);
    const fromCanonical = extractAllAjoVfIdsFromHtml(canonicalHtml);
    return [...new Set([...fromModules, ...fromCanonical])];
  }, [modules, canonicalHtml]);

  const [vfDiag, setVfDiag] = useState({ expected: [], best: [], sanitized: [] });

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

  // Operation queue
  const opQueueRef = useRef(Promise.resolve());
  const pendingRenderIntentRef = useRef(null);
  const [activeRenderIntent, setActiveRenderIntent] = useState(null);
  function enqueue(asyncFn) {
    opQueueRef.current = opQueueRef.current
      .then(() => asyncFn())
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("Queued op failed:", e);
      });
    return opQueueRef.current;
  }

  function queueRenderIntent(kind, meta = {}) {
    pendingRenderIntentRef.current = { kind, ...meta, at: Date.now() };
  }

  function showAutoPatternToast(message) {
    if (autoPatternToastTimerRef.current) {
      clearTimeout(autoPatternToastTimerRef.current);
      autoPatternToastTimerRef.current = null;
    }
    setAutoPatternToast(message);
    autoPatternToastTimerRef.current = setTimeout(() => {
      setAutoPatternToast("");
      autoPatternToastTimerRef.current = null;
    }, 5000);
  }

  useEffect(() => {
    return () => {
      if (autoPatternToastTimerRef.current) {
        clearTimeout(autoPatternToastTimerRef.current);
        autoPatternToastTimerRef.current = null;
      }
    };
  }, []);

  // Iframe message listener (bridge)
  useEffect(() => {
    function onMessage(ev) {
      const msg = ev?.data;
      if (!msg || msg.__TS_PREVIEW__ !== true) return;

      if (focusDebug && msg.type === "focus-ack") {
        // eslint-disable-next-line no-console
        console.log("focus-ack", msg.data);
      }

      setIframeMsgs((prev) => {
        const next = [...prev, { at: new Date().toISOString(), ...msg }];
        return next.slice(-200);
      });

      if (msg.type === "error" || msg.type === "unhandledrejection") {
        const m = msg?.data?.message || msg.type;
        setRenderError((cur) => cur || `Preview iframe error: ${m}`);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function loadPrbList() {
    const res = await actionWebInvoke(actions["aem-prb-list"]);
    const items = res?.data?.prbPropertiesList?.items || [];

    setPrbOptions(
      items.map((it) => {
        const displayName = it.name || it.prbNumber || it._path || it._id;
        return {
          id: it._id,
          label: it.prbNumber && it.name ? `${it.prbNumber} — ${it.name}` : displayName,
          prbNumber: it.prbNumber || "",
          name: it.name || "",
          raw: it,
        };
      })
    );
  }

  async function loadTemplateById(tid) {
    if (!tid) return;
    const getRes = await actionWebInvoke(actions["ajo-template-get"], headers, { templateId: tid });
    const html = getRes?.htmlBody;
    if (!html) {
      // eslint-disable-next-line no-console
      console.warn("Template fetched but no htmlBody found:", getRes);
      return;
    }

    const hydrated = hydrateFromHtml(html);
    queueRenderIntent("template-load");
    setCanonicalHtml(html);

    if (hydrated?.prbCfId) {
      setSelectedPrbId(hydrated.prbCfId);
      const prbObj = prbOptions.find((o) => o.id === hydrated.prbCfId) || null;
      setSelectedPrb(prbObj);
    } else if (prbId) {
      setSelectedPrbId(prbId);
    }

    setModules(Array.isArray(hydrated?.modules) ? hydrated.modules : []);
  }

  async function loadVfs() {
    const res = await actionWebInvoke(actions["ajo-vf-list"], headers, { debug: true });
    const items = res?.items || res?.fragments || [];
    setVfItems(items);
    setVfAutoInsertConfig({
      compiledReferencesTagId: res?.autoInsertConfig?.compiledReferencesTagId || null,
      footerTagId: res?.autoInsertConfig?.footerTagId || null,
      compiledReferencesDefaultVfId: normalizeVfId(res?.autoInsertConfig?.compiledReferencesDefaultVfId),
    });
    setVfDebugSample(res?.debug?.sample || null);
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
          bodyCopy: Array.isArray(it?.bodyCopy) ? it.bodyCopy : [],
          references: Array.isArray(it?.references) ? it.references : [],
          hasDynamicReferences: hasDynamicReferenceTokens(it),
        }))
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Load Content CFs failed:", e);
    }
  }

  // Initial load: PRBs + (auto) vf/content libraries
  useEffect(() => {
    loadPrbList();
    loadVfs();
    loadContentList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link: load template on entry
  useEffect(() => {
    if (!templateId) return;
    loadTemplateById(templateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // Resolve selectedPrb once options are loaded
  useEffect(() => {
    if (!selectedPrbId) return;
    const prbObj = prbOptions.find((o) => o.id === selectedPrbId) || null;
    setSelectedPrb(prbObj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prbOptions, selectedPrbId]);

  async function setPrb(prbIdNext) {
    if (isUpdatingPrb) return;

    setSelectedPrbId(prbIdNext);
    const prbObj = prbOptions.find((o) => o.id === prbIdNext) || null;
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

        queueRenderIntent("prb-change", { prbId: prbObj.id });
        setCanonicalHtml(nextHtml);

        await actionWebInvoke(actions["ajo-template-update"], headers, {
          templateId,
          name: prbNumber ? `${prbNumber} — ${templateName}` : templateName,
          labels: buildLabelsForPrb(prbNumber),
          html: nextHtml,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("PRB update failed:", e);
      } finally {
        setIsUpdatingPrb(false);
      }
    });
  }

  function addPattern(vfId) {
    if (!templateId) return;
    if (!vfId) return;
    if (!canonicalHtml) return;

    enqueue(async () => {
      const vfName = (vfItems.find((v) => v?.id === vfId)?.name || "").trim() || null;
      const moduleId = `m_${Date.now()}`;
      const nextModules = [
        ...modules,
        {
          moduleId,
          vfId,
          contentId: null,
          vars: { firstName: "" },
        },
      ];
      const vfOrdinal = nextModules.filter((m) => m?.vfId === vfId).length - 1;
      setModules(nextModules);
      setPendingScrollModuleId(moduleId);
      setPinnedModule({ moduleId, vfId });
      setHoveredModule(null);
      setPendingFocusModule({ moduleId, vfId, vfOrdinal });

      const nextHtml = appendPatternOnlyToTemplateHtml(canonicalHtml, { vfId, vfName, moduleId });
      queueRenderIntent("pattern-add", { moduleId, vfId });
      setCanonicalHtml(nextHtml);
    });
  }

  function tryDirectIframeFocus({ vfId, vfOrdinal }) {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !vfId) {
      if (focusDebug) {
        // eslint-disable-next-line no-console
        console.log("focus-direct: no iframe document or vfId", { hasDoc: Boolean(doc), vfId });
      }
      return false;
    }

    const styleId = "ts-focus-style";
    if (!doc.getElementById(styleId)) {
      const style = doc.createElement("style");
      style.id = styleId;
      style.textContent =
        ".ts-vf-focus{outline:2px solid #2f6fed;box-shadow:0 0 0 4px rgba(47,111,237,.18);transition:outline-color 120ms ease,box-shadow 120ms ease;}";
      doc.head?.appendChild(style);
    }

    doc.querySelectorAll(".ts-vf-focus").forEach((el) => el.classList.remove("ts-vf-focus"));
    const hits = doc.querySelectorAll(`[data-fragment-id="ajo:${vfId}"]`);
    if (!hits.length) {
      if (focusDebug) {
        // eslint-disable-next-line no-console
        console.log("focus-direct: no matches", { vfId });
      }
      return false;
    }
    const idx = typeof vfOrdinal === "number" ? Math.min(Math.max(vfOrdinal, 0), hits.length - 1) : 0;
    const target = hits[idx];
    if (!target) return false;
    target.classList.add("ts-vf-focus");
    try {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      // ignore
    }
    return true;
  }

  function clearDirectIframeFocus() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return false;
    doc.querySelectorAll(".ts-vf-focus").forEach((el) => el.classList.remove("ts-vf-focus"));
    return true;
  }

  function focusPreviewVf({ moduleId, vfId, vfOrdinal: vfOrdinalInput }) {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    let vfOrdinal = Number.isFinite(vfOrdinalInput) ? vfOrdinalInput : 0;
    if (!Number.isFinite(vfOrdinalInput)) {
      const moduleIndex = modules.findIndex((m) => m.moduleId === moduleId);
      if (moduleIndex >= 0) {
        const same = modules.slice(0, moduleIndex + 1).filter((m) => m?.vfId === vfId);
        vfOrdinal = Math.max(0, same.length - 1);
      }
    }
    if (focusDebug) {
      // eslint-disable-next-line no-console
      console.log("focus->iframe", { moduleId, vfId, vfOrdinal });
    }
    if (tryDirectIframeFocus({ vfId, vfOrdinal })) return;
    win.postMessage({ __TS_PREVIEW__: true, type: "focus-vf", vfId, moduleId, vfOrdinal }, "*");
  }

  function clearPreviewFocus() {
    if (clearDirectIframeFocus()) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ __TS_PREVIEW__: true, type: "clear-vf" }, "*");
  }

  function emitPreviewOpStart(intent) {
    const win = iframeRef.current?.contentWindow;
    if (!win || !intent) return;
    const payload = {
      kind: intent.kind,
      moduleId: intent.moduleId || null,
      vfId: intent.vfId || null,
      vfOrdinal: null,
      preferPlaceholder: intent.kind === "pattern-add",
    };
    if (intent.moduleId) {
      const idx = modules.findIndex((m) => m?.moduleId === intent.moduleId);
      if (idx >= 0) {
        const vfId = intent.vfId || modules[idx]?.vfId || null;
        payload.vfId = vfId;
        if (vfId) {
          const same = modules.slice(0, idx + 1).filter((m) => m?.vfId === vfId);
          payload.vfOrdinal = Math.max(0, same.length - 1);
        }
      }
    }
    win.postMessage({ __TS_PREVIEW__: true, type: "preview-op-start", data: payload }, "*");
  }

  function isInteractiveTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(
      target.closest(
        "button,[role='button'],[role='combobox'],[role='listbox'],input,select,textarea,a,.spectrum-Button,.spectrum-Textfield,.spectrum-ComboBox"
      )
    );
  }

  function safeInjectMarkers(html) {
    try {
      return injectPreviewMarkers(html);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Preview marker inject failed:", e);
      return html;
    }
  }

  function safeInjectFocusBridge(html) {
    try {
      return injectPreviewFocusBridge(html);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Preview focus bridge inject failed:", e);
      return html;
    }
  }

  const activeModuleId = pinnedModule?.moduleId || hoveredModule?.moduleId || null;
  const activeVfId = pinnedModule?.vfId || hoveredModule?.vfId || null;

  useEffect(() => {
    if (!activeVfId && !activeModuleId) {
      clearPreviewFocus();
      return;
    }
    focusPreviewVf({ moduleId: activeModuleId, vfId: activeVfId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVfId, activeModuleId]);

  useEffect(() => {
    function onDocClick(ev) {
      const root = compositionRef.current;
      if (!root || typeof root.contains !== "function") return;
      const inComposition = root.contains(ev.target);
      const inPopover = ev.target?.closest
        ? ev.target.closest(
            ".spectrum-Popover, .spectrum-Modal, .spectrum-Dialog, .spectrum-Overlay, [role=\"listbox\"], [role=\"dialog\"]"
          )
        : null;
      const card = ev.target?.closest ? ev.target.closest("[data-module-id]") : null;
      const clickedModuleId = card?.getAttribute ? card.getAttribute("data-module-id") : null;

      if (inPopover) return;

      if (!inComposition) {
        if (pinnedModule) setPinnedModule(null);
        return;
      }

      if (!card) {
        if (pinnedModule) setPinnedModule(null);
        return;
      }

      if (pinnedModule && clickedModuleId !== pinnedModule.moduleId) {
        setPinnedModule(null);
      }
    }

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pinnedModule]);

  useEffect(() => {
    if (!pendingScrollModuleId) return;
    const list = compositionListRef.current;
    if (!list || typeof list.querySelector !== "function") return;
    const el = list.querySelector(`[data-module-id="${pendingScrollModuleId}"]`);
    if (!el) return;
    requestAnimationFrame(() => {
      try {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      } catch {
        const top = el.offsetTop || 0;
        list.scrollTop = Math.max(top - 8, 0);
      }
      setPendingScrollModuleId(null);
    });
  }, [modules, pendingScrollModuleId]);

  function vfHasTagId(vfId, tagId) {
    if (!vfId || !tagId) return false;
    const cleanVfId = normalizeVfId(vfId);
    const hit = (vfItems || []).find((v) => normalizeVfId(v?.id) === cleanVfId) || null;
    const tagIds = Array.isArray(hit?.tagIds) ? hit.tagIds : [];
    return tagIds.some((t) => String(t || "") === String(tagId));
  }

  function isCompiledReferencesModule(mod) {
    const compiledTagId = vfAutoInsertConfig?.compiledReferencesTagId || null;
    const compiledDefaultVfId = normalizeVfId(vfAutoInsertConfig?.compiledReferencesDefaultVfId);
    return vfHasTagId(mod?.vfId, compiledTagId) || (compiledDefaultVfId && normalizeVfId(mod?.vfId) === compiledDefaultVfId);
  }

  function moduleHasDynamicReferences(mod) {
    if (!mod?.contentId) return false;
    const content = (contentOptions || []).find((c) => c?.id === mod.contentId) || null;
    // Conservative default: unknown content could still contain dynamic references.
    if (!content) return true;
    return content?.hasDynamicReferences === true || hasDynamicReferenceTokens(content);
  }

  function bindContent(moduleId, contentId) {
    if (!templateId) return;
    if (!moduleId || !contentId) return;
    if (!canonicalHtml) return;

    const m = modules.find((x) => x.moduleId === moduleId);
    if (!m?.vfId) return;
    const vfName = (vfItems.find((v) => v?.id === m.vfId)?.name || "").trim() || null;
    const focusTarget = { moduleId, vfId: m.vfId };
    setPinnedModule(focusTarget);
    setHoveredModule(null);
    setPendingFocusModule(focusTarget);
    const selectedContent = (contentOptions || []).find((c) => c?.id === contentId) || null;
    const contentHasDynamicReferences =
      selectedContent?.hasDynamicReferences === true || hasDynamicReferenceTokens(selectedContent || {});
    if (contentHasDynamicReferences) {
      pendingAutoRefVfInsertRef.current = {
        sourceModuleId: moduleId,
        sourceContentId: contentId,
        requestedAt: Date.now(),
      };
    } else {
      pendingAutoRefVfInsertRef.current = null;
    }

    enqueue(async () => {
      let nextModules = modules.map((x) => (x.moduleId === moduleId ? { ...x, contentId } : x));

      let nextHtml = bindContentInModuleHtml(canonicalHtml, {
        moduleId,
        vfId: m.vfId,
        vfName,
        aemCfId: contentId,
        repoId,
        vars: m.vars || { firstName: "" },
      });

      setModules(nextModules);
      queueRenderIntent("vf-hydration", { moduleId, contentId });
      setCanonicalHtml(nextHtml);
    });
  }

  function removeModule(moduleId) {
    if (!moduleId) return;

    enqueue(async () => {
      setModules((prev) => prev.filter((m) => m.moduleId !== moduleId));
      queueRenderIntent("module-remove", { moduleId });
      setCanonicalHtml((prevHtml) => removeModuleFromTemplateHtml(prevHtml, moduleId));
    });
  }

  function moveModule(moduleId, direction) {
    if (!moduleId) return;
    if (direction !== "up" && direction !== "down") return;

    enqueue(async () => {
      setModules((prev) => {
        const idx = prev.findIndex((m) => m?.moduleId === moduleId);
        if (idx < 0) return prev;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= prev.length) return prev;
        const next = prev.slice();
        const tmp = next[idx];
        next[idx] = next[targetIdx];
        next[targetIdx] = tmp;
        return next;
      });

      queueRenderIntent("module-reorder", { moduleId, direction });
      setCanonicalHtml((prevHtml) => moveModuleInTemplateHtml(prevHtml, moduleId, direction));
    });
  }

  async function renderPreview() {
    let canonicalForRender = "";
    try {
      setRenderError("");
      setPreviewWarnings([]);
      setIframeMsgs([]);
      setIsRendering(true);
      const intent = pendingRenderIntentRef.current || { kind: "rerender" };
      pendingRenderIntentRef.current = null;
      setActiveRenderIntent(intent);
      if (intent.kind === "vf-hydration" || intent.kind === "pattern-add") emitPreviewOpStart(intent);

      try {
        previewScrollRef.current = iframeRef.current?.contentWindow?.scrollY || 0;
      } catch {
        previewScrollRef.current = 0;
      }

      if (!canonicalHtml) {
        setPreviewHtml("<html><body><p>No HTML loaded yet.</p></body></html>");
        return;
      }

      canonicalForRender = stripTsModuleMarkers(canonicalHtml);

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
        html: canonicalForRender,
        renderContext,
      });

      setLastRenderResult(res || null);

      const best = resolvePreviewHtmlFromRenderResult(res, canonicalForRender);
      if (!best || typeof best !== "string") {
        setPreviewHtml("<html><body><p>Render succeeded but returned no HTML.</p></body></html>");
        return;
      }

      const sanitized = stripAjoSyntax(best);

      setLastBestHtml(best);
      setLastSanitizedHtml(sanitized);

      if (enableDiagnostics) {
        setVfDiag({
          expected: extractAllAjoVfIdsFromHtml(canonicalHtml),
          best: extractAllAjoVfIdsFromHtml(best),
          sanitized: extractAllAjoVfIdsFromHtml(sanitized),
        });

        const warnings = computePreviewWarnings({
          canonicalHtml,
          bestHtml: best,
          sanitizedHtml: sanitized,
          expectedVfIds,
        });
        setPreviewWarnings(warnings);
      } else {
        setVfDiag({ expected: [], best: [], sanitized: [] });
        setPreviewWarnings([]);
      }

      const bridged = enableIframeBridge ? injectPreviewBridge(sanitized, expectedVfIds) : sanitized;
      const marked = safeInjectMarkers(bridged);
      const withFocusBridge = safeInjectFocusBridge(marked);
      setPreviewHtml(withFocusBridge);

      // Defer compiled-references auto-insert until the initial CF hydration render has completed.
      if (intent.kind === "vf-hydration" && pendingAutoRefVfInsertRef.current) {
        const pending = pendingAutoRefVfInsertRef.current;
        pendingAutoRefVfInsertRef.current = null;

        enqueue(async () => {
          const currentModules = Array.isArray(modulesRef.current) ? modulesRef.current : [];
          const currentHtml = canonicalHtmlRef.current || "";
          if (!currentHtml) return;

          const compiledTagId = vfAutoInsertConfig?.compiledReferencesTagId || null;
          const footerTagId = vfAutoInsertConfig?.footerTagId || null;
          const compiledDefaultVfId = normalizeVfId(vfAutoInsertConfig?.compiledReferencesDefaultVfId);
          if (!compiledDefaultVfId) return;

          const hasCompiledPattern = currentModules.some(
            (mod) =>
              vfHasTagId(mod?.vfId, compiledTagId) ||
              normalizeVfId(mod?.vfId) === compiledDefaultVfId
          );
          if (hasCompiledPattern) return;

          const footerModule = currentModules.find((mod) => vfHasTagId(mod?.vfId, footerTagId)) || null;
          const compiledModuleId = `m_${Date.now()}_compiled_refs`;
          const compiledVfMeta = (vfItems || []).find((v) => normalizeVfId(v?.id) === compiledDefaultVfId) || null;
          const compiledVfName = (compiledVfMeta?.name || "").trim() || null;
          const compiledModule = {
            moduleId: compiledModuleId,
            vfId: compiledDefaultVfId,
            contentId: null,
            vars: { firstName: "" },
          };

          let nextModules;
          let nextHtml;
          if (footerModule?.moduleId) {
            const footerIndex = currentModules.findIndex((mod) => mod?.moduleId === footerModule.moduleId);
            const insertAt = footerIndex >= 0 ? footerIndex : currentModules.length;
            nextModules = [...currentModules.slice(0, insertAt), compiledModule, ...currentModules.slice(insertAt)];
            nextHtml = insertPatternBeforeModuleHtml(currentHtml, {
              vfId: compiledDefaultVfId,
              vfName: compiledVfName,
              moduleId: compiledModuleId,
              beforeModuleId: footerModule.moduleId,
            });
          } else {
            nextModules = [...currentModules, compiledModule];
            nextHtml = appendPatternOnlyToTemplateHtml(currentHtml, {
              vfId: compiledDefaultVfId,
              vfName: compiledVfName,
              moduleId: compiledModuleId,
            });
          }

          setModules(nextModules);
          queueRenderIntent("pattern-add", {
            moduleId: compiledModuleId,
            vfId: compiledDefaultVfId,
            sourceModuleId: pending.sourceModuleId,
            sourceContentId: pending.sourceContentId,
          });
          setCanonicalHtml(nextHtml);
          showAutoPatternToast("Pattern Automatically Added: Compiled Reference Statements");
        });
      }

      // After hydration/removal renders, clean up compiled-reference pattern if no dynamic refs remain.
      if (intent.kind === "vf-hydration" || intent.kind === "module-remove") {
        enqueue(async () => {
          const currentModules = Array.isArray(modulesRef.current) ? modulesRef.current : [];
          const currentHtml = canonicalHtmlRef.current || "";
          if (!currentModules.length || !currentHtml) return;

          const hasAnyDynamicRefs = currentModules.some((mod) => moduleHasDynamicReferences(mod));
          if (hasAnyDynamicRefs) return;

          const compiledModules = currentModules.filter((mod) => isCompiledReferencesModule(mod));
          if (!compiledModules.length) return;

          const removeIds = new Set(compiledModules.map((m) => m.moduleId).filter(Boolean));
          const nextModules = currentModules.filter((m) => !removeIds.has(m.moduleId));
          let nextHtml = currentHtml;
          for (const mod of compiledModules) {
            if (!mod?.moduleId) continue;
            nextHtml = removeModuleFromTemplateHtml(nextHtml, mod.moduleId);
          }

          setModules(nextModules);
          queueRenderIntent("module-remove", { auto: true, reason: "compiled-references-cleanup" });
          setCanonicalHtml(nextHtml);
          showAutoPatternToast("Pattern Automatically Removed: Compiled Reference Statements");
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Render preview failed:", e);
      setRenderError(e?.message || "Render failed");
      setPreviewWarnings([]);
      const fallback = stripAjoSyntax(canonicalForRender || "<html><body><p>Render failed.</p></body></html>");
      const marked = safeInjectMarkers(fallback);
      setPreviewHtml(safeInjectFocusBridge(marked));
    } finally {
      setIsRendering(false);
      setActiveRenderIntent(null);
    }
  }

  // Auto-render on canonicalHtml changes (same behavior)
  useEffect(() => {
    if (!canonicalHtml) return;

    const t = setTimeout(() => {
      renderPreview();
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalHtml]);

  // Diagnostics recompute on tab switch (same behavior)
  useEffect(() => {
    if (activeTab !== "diagnostics") return;
    if (!canonicalHtml || !lastBestHtml || !lastSanitizedHtml) return;

    setVfDiag({
      expected: extractAllAjoVfIdsFromHtml(canonicalHtml),
      best: extractAllAjoVfIdsFromHtml(lastBestHtml),
      sanitized: extractAllAjoVfIdsFromHtml(lastSanitizedHtml),
    });

    const warnings = computePreviewWarnings({
      canonicalHtml,
      bestHtml: lastBestHtml,
      sanitizedHtml: lastSanitizedHtml,
      expectedVfIds,
    });
    setPreviewWarnings(warnings);
  }, [activeTab, canonicalHtml, lastBestHtml, lastSanitizedHtml, expectedVfIds]);

  const prbStatus = selectedPrbId ? "configured" : "missing";

  const aemWarnings = Array.isArray(lastRenderResult?.aemWarnings) ? lastRenderResult.aemWarnings : [];
  const resolutionWarnings = Array.isArray(lastRenderResult?.resolutionWarnings) ? lastRenderResult.resolutionWarnings : [];
  const aemPrefetch = Array.isArray(lastRenderResult?.aemPrefetch) ? lastRenderResult.aemPrefetch : [];
  const perf = lastRenderResult?.perf || null;

  const serverPreviewDiagnostics = useMemo(() => {
    const r = lastRenderResult || {};
    return r.previewDiagnostics || r.diagnostics || r.diagnostic || null;
  }, [lastRenderResult]);

  const serverRenderTokens = useMemo(() => {
    const rt = serverPreviewDiagnostics?.preview?.renderTokens || null;
    return rt && typeof rt === "object" ? rt : null;
  }, [serverPreviewDiagnostics]);

  const serverDynamicRefs = useMemo(() => {
    const dr = serverRenderTokens?.dynamicReferences || null;
    return dr && typeof dr === "object" ? dr : null;
  }, [serverRenderTokens]);

  const serverVfDiag = lastRenderResult?.vfDiag || null;
  const stitchReport = lastRenderResult?.stitchReport || null;
  const fragmentsResolvedAll = Array.isArray(lastRenderResult?.fragmentsResolvedAll)
    ? lastRenderResult.fragmentsResolvedAll
    : Array.isArray(lastRenderResult?.fragmentsResolved)
      ? lastRenderResult.fragmentsResolved
      : [];

  useEffect(() => {
    if (focusDebugFromUrl) setFocusDebug(true);
  }, [focusDebugFromUrl]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ts_focus_debug", focusDebug ? "1" : "0");
    } catch {
      // ignore
    }
  }, [focusDebug]);

  const moduleSkeletonHints = useMemo(() => {
    const hinted = extractModuleSkeletonHints(canonicalHtml);
    if (hinted.length) return hinted.slice(0, 3);
    return (modules || []).slice(0, 3).map((m, i) => ({
      moduleId: m?.moduleId || `fallback-${i}`,
      hasImage: i % 2 === 0,
      textWeight: i % 2 === 0 ? 4 : 3,
    }));
  }, [canonicalHtml, modules]);

  const loadingUi = useMemo(() => {
    const kind = activeRenderIntent?.kind || "rerender";
    if (kind === "pattern-add") {
      return { title: "Adding pattern", detail: "Updating preview with the new module.", mode: "targeted" };
    }
    if (kind === "vf-hydration") {
      return { title: "Hydrating content", detail: "Applying content fragment data.", mode: "targeted" };
    }
    if (kind === "module-reorder") {
      return { title: "Reordering modules", detail: "Refreshing preview order.", mode: "soft" };
    }
    if (kind === "module-remove") {
      return { title: "Removing module", detail: "Refreshing preview composition.", mode: "soft" };
    }
    if (kind === "prb-change") {
      return { title: "Applying PRB", detail: "Recomputing brand and context variables.", mode: "soft" };
    }
    if (kind === "template-load") {
      return { title: "Loading template", detail: "Preparing preview canvas.", mode: "skeleton" };
    }
    if (kind === "manual") {
      return { title: "Rendering preview", detail: "Running server-side render pipeline.", mode: "soft" };
    }
    return { title: "Updating preview", detail: "Applying latest changes.", mode: "soft" };
  }, [activeRenderIntent]);

  useEffect(() => {
    modulesRef.current = Array.isArray(modules) ? modules : [];
  }, [modules]);

  useEffect(() => {
    canonicalHtmlRef.current = canonicalHtml || "";
  }, [canonicalHtml]);

  return (
    <View>
      {mode === "route" ? (
        <View>
          <Flex justifyContent="space-between" alignItems="center" wrap>
            <View>
              <Heading level={2}>Template Studio</Heading>
              <Text UNSAFE_style={{ opacity: 0.75 }}>
                PRB: {selectedPrb?.label || selectedPrbId || prbId || "(none)"} • templateId: {templateId || "(none)"}
              </Text>
            </View>

            <Flex gap="size-100">
              <Button variant="secondary" onPress={() => nav(`/prb/${encodeURIComponent(prbId || selectedPrbId || "")}/templates`)}>
                Back to templates
              </Button>
              <Button variant="secondary" onPress={() => nav("/prb")}>
                Change PRB
              </Button>
            </Flex>
          </Flex>

          <Divider size="S" marginY="size-200" />
        </View>
      ) : null}

      {/* Studio content starts here */}
      {autoPatternToast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "10vh",
            transform: "translateX(-50%)",
            zIndex: 9999,
            width: "min(760px, calc(100vw - 40px))",
            background: "#0f172a",
            color: "#ffffff",
            border: "1px solid #1d4ed8",
            borderRadius: 10,
            boxShadow: "0 12px 28px rgba(2, 6, 23, 0.42)",
            padding: "12px 14px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.2px",
            textAlign: "center",
          }}
        >
          {autoPatternToast}
        </div>
      ) : null}

      {/* 2-column Studio */}
      <Grid columns={["0.85fr", "1.15fr"]} gap="size-200" height="80vh" UNSAFE_className="StudioGrid">
        {/* Left: Composition */}
        <div ref={compositionRef}>
          <View
            borderWidth="thin"
            borderColor="dark"
            borderRadius="small"
            padding="size-200"
            UNSAFE_className="StudioPanel"
          >
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Composition</Heading>

            <DialogTrigger>
              <Button variant="cta" isDisabled={!templateId || !canonicalHtml}>
                Add pattern
              </Button>
              <PatternPickerDialog vfItems={vfItems} onSelect={addPattern} />
            </DialogTrigger>
          </Flex>

          <Text marginTop="size-100" UNSAFE_style={{ opacity: 0.8 }}>
            Add a pattern first, then bind content inline.
          </Text>

          <Divider size="S" marginY="size-200" />

          <div style={{ height: "72vh", overflow: "auto" }} ref={compositionListRef}>
            {!modules.length ? (
              <Text UNSAFE_style={{ opacity: 0.85 }}>No modules yet. Add a pattern to start.</Text>
            ) : (
              modules.map((m, idx) => (
                <div
                  key={`wrap-${m.moduleId}`}
                  data-module-id={m.moduleId}
                  onPointerEnter={() => {
                    if (pinnedModule) return;
                    const next = { moduleId: m.moduleId, vfId: m.vfId };
                    setHoveredModule(next);
                    focusPreviewVf(next);
                  }}
                  onPointerLeave={() => {
                    if (pinnedModule) return;
                    setHoveredModule(null);
                  }}
                  onClick={(ev) => {
                    if (isInteractiveTarget(ev.target)) return;
                    setPinnedModule((cur) => {
                      const next = cur?.moduleId === m.moduleId ? null : { moduleId: m.moduleId, vfId: m.vfId };
                      if (next) focusPreviewVf(next);
                      return next;
                    });
                    setHoveredModule(null);
                  }}
                >
                  <ModuleCard
                    key={m.moduleId}
                    module={m}
                    index={idx}
                    vfItems={vfItems}
                    contentOptions={contentOptions}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < modules.length - 1}
                    isFocused={activeModuleId === m.moduleId}
                    isPinned={pinnedModule?.moduleId === m.moduleId}
                    onBindContent={bindContent}
                    onMoveUp={(id) => moveModule(id, "up")}
                    onMoveDown={(id) => moveModule(id, "down")}
                    onRemove={removeModule}
                  />
                </div>
              ))
            )}
          </div>
        </View>
        </div>

        {/* Right: Preview + Diagnostics tabs */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200" UNSAFE_className="StudioPreviewPanel">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Preview</Heading>
            <Button
              variant="primary"
              onPress={() => {
                queueRenderIntent("manual");
                renderPreview();
              }}
              isDisabled={!canonicalHtml || isRendering}
            >
              {isRendering ? "Rendering…" : "Render preview"}
            </Button>
          </Flex>

          <Divider size="S" marginY="size-150" />

          <Tabs aria-label="Preview Tabs" selectedKey={activeTab} onSelectionChange={setActiveTab}>
            <TabList>
              <Item key="preview">Preview</Item>
              <Item key="html">AJO HTML</Item>
              <Item key="aem">AEM</Item>
              <Item key="diagnostics">Diagnostics</Item>
            </TabList>

            <TabPanels>
              <Item key="preview">
                <View borderWidth="thin" borderColor="light" borderRadius="small" height="70vh" padding="size-100">
                  {renderError ? (
                    <View marginBottom="size-100">
                      <StatusLight variant="negative">{renderError}</StatusLight>
                    </View>
                  ) : null}

                  <div className={`PreviewCanvas ${isRendering && loadingUi.mode !== "targeted" ? "is-rendering" : ""}`}>
                    <iframe
                      title="Email Preview"
                      style={{ width: "100%", height: "100%", border: "none" }}
                      sandbox="allow-same-origin allow-scripts"
                      srcDoc={previewHtml}
                      ref={iframeRef}
                      onLoad={() => {
                        try {
                          const win = iframeRef.current?.contentWindow;
                          if (!win) return;
                          const y = previewScrollRef.current || 0;
                          if (y > 0) win.scrollTo(0, y);
                          const focus = pendingFocusModule || (activeModuleId || activeVfId ? { moduleId: activeModuleId, vfId: activeVfId } : null);
                          if (focus?.vfId || focus?.moduleId) {
                            focusPreviewVf(focus);
                            if (pendingFocusModule) setPendingFocusModule(null);
                          }
                        } catch {
                          // ignore
                        }
                      }}
                    />
                    {isRendering && loadingUi.mode !== "targeted" ? (
                      <div className={`PreviewLoadingOverlay mode-${loadingUi.mode}`} aria-live="polite">
                        <div className="PreviewLoadingHeader">
                          <div className="PreviewLoadingDot" />
                          <div>
                            <div className="PreviewLoadingTitle">{loadingUi.title}</div>
                            <div className="PreviewLoadingDetail">{loadingUi.detail}</div>
                          </div>
                        </div>
                        {loadingUi.mode === "skeleton" ? (
                          <div className="PreviewSkeletonStack">
                            {moduleSkeletonHints.map((hint) => (
                              <div className="PreviewSkeletonCard" key={`sk-${hint.moduleId}`}>
                                <div className="PreviewSkeletonText">
                                  {Array.from({ length: hint.textWeight }).map((_, i) => (
                                    <div key={`${hint.moduleId}-t-${i}`} className={`PreviewSkLine ${i === 0 ? "is-lg" : ""}`} />
                                  ))}
                                </div>
                                {hint.hasImage ? <div className="PreviewSkImage" /> : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="PreviewLoadingProgress" />
                        )}
                      </div>
                    ) : null}
                  </div>
                </View>
              </Item>

              <Item key="html">
                <View borderWidth="thin" borderColor="light" borderRadius="small" padding="size-200" height="64vh" overflow="auto">
                  <pre style={{ whiteSpace: "pre-wrap" }}>{stripTsModuleMarkers(canonicalHtml) || "(empty)"}</pre>
                </View>
              </Item>

              <Item key="aem">
                <View height="64vh" overflow="auto">
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
                      <View borderWidth="thin" borderColor="light" borderRadius="small" padding="size-200" overflow="auto" height="size-2400">
                        <pre style={{ whiteSpace: "pre-wrap" }}>{safeJson(lastRenderResult, 2)}</pre>
                      </View>
                    </View>
                  ) : null}
                </View>
              </Item>

              <Item key="diagnostics">
                <View height="64vh" overflow="auto">
                  <View marginBottom="size-150">
                    <Heading level={5}>Runtime diagnostics</Heading>
                    <Text UNSAFE_style={{ opacity: 0.85 }}>
                      Inspect iframe messages, DOM checks, and server diagnostics without spamming console logs.
                    </Text>
                  </View>

                  <View marginBottom="size-150">
                    <Switch isSelected={enableIframeBridge} onChange={setEnableIframeBridge}>
                      Enable iframe bridge (postMessage DOM + error signals)
                    </Switch>
                    <Text UNSAFE_style={{ opacity: 0.8, marginTop: 6 }}>
                      When enabled, next render injects a small script into preview HTML to report DOM checks and runtime errors.
                    </Text>
                  </View>

                  <View marginBottom="size-150">
                    <Switch isSelected={focusDebug} onChange={setFocusDebug}>
                      Enable focus debug (logs focus messages)
                    </Switch>
                    <Text UNSAFE_style={{ opacity: 0.8, marginTop: 6 }}>
                      Persists in localStorage. Useful when shell strips query params.
                    </Text>
                  </View>

                  <View marginBottom="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>VF survival diagnostics</Heading>

                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      expected(from canonical)={vfDiagSummary.expectedCount} • best(after render)={vfDiagSummary.bestCount} •
                      sanitized(after strip)={vfDiagSummary.sanitizedCount}
                    </Text>

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

                  <View marginBottom="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>Iframe messages</Heading>
                    <Divider size="S" marginY="size-100" />
                    {!iframeMsgs.length ? (
                      <Text UNSAFE_style={{ opacity: 0.85 }}>No iframe messages yet. Enable bridge and render preview.</Text>
                    ) : (
                      iframeMsgs.slice(-80).map((m, i) => (
                        <View key={`im-${i}`} marginBottom="size-50">
                          <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                            {m.at} — {m.type}: {safeJson(m.data, 0)}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>

                  <View borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>Computed preview warnings</Heading>
                    <Divider size="S" marginY="size-100" />
                    {!previewWarnings.length ? (
                      <Text UNSAFE_style={{ opacity: 0.85 }}>No warnings computed.</Text>
                    ) : (
                      previewWarnings.map((w, i) => (
                        <View key={`dw-${i}`} marginBottom="size-50">
                          <StatusLight variant="negative">{w}</StatusLight>
                        </View>
                      ))
                    )}
                  </View>

                  <View marginTop="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>Server stitching diagnostics</Heading>
                    <Divider size="S" marginY="size-100" />
                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      vfDiag: {safeJson(serverVfDiag, 2)}
                    </Text>
                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      stitchReport: {safeJson(stitchReport, 2)}
                    </Text>
                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      fragmentsResolvedAll(count): {Array.isArray(fragmentsResolvedAll) ? fragmentsResolvedAll.length : 0}
                    </Text>
                  </View>

                  <View marginTop="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>Server render diagnostics</Heading>
                    <Divider size="S" marginY="size-100" />
                    <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                      previewDiagnostics: {safeJson(serverPreviewDiagnostics, 2)}
                    </Text>
                    {serverDynamicRefs ? (
                      <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                        dynamicReferences: {safeJson(serverDynamicRefs, 2)}
                      </Text>
                    ) : null}
                  </View>

                  {vfDebugSample ? (
                    <View marginTop="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                      <Heading level={5}>VF Debug Sample</Heading>
                      <Divider size="S" marginY="size-100" />
                      <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                        {safeJson(vfDebugSample, 2)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Item>
            </TabPanels>
          </Tabs>
        </View>
      </Grid>
    </View>
  );
}

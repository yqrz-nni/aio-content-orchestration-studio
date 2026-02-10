// File: src/dx-excshell-1/web-src/src/screens/TemplateStudio.jsx
//
// NOTE:
// - Preserves your existing render pipeline, diagnostics, and sequential cf rebinding model.
// - Adds routing support via prbId/templateId params.
// - Implements “Add pattern” (VF-first) + inline “Bind content” per module,
//   without stripping out your existing left/right libraries or diagnostics tabs.
//
// IMPORTANT: You will likely want to create a dedicated action to LIST templates by PRB.
// This file does not require that action.

import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  Switch,
  DialogTrigger,
} from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";
import { ImsContext } from "../context/ImsContext";

import {
  applyPrbToTemplateHtml,
  appendPatternOnlyToTemplateHtml,
  bindContentInModuleHtml,
  hydrateFromHtml,
} from "../studio/templateEngine";

import {
  stripAjoSyntax,
  injectPreviewBridge,
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

/* =============================================================================
 * Component
 * ============================================================================= */

export function TemplateStudio() {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  const nav = useNavigate();
  const { prbId, templateId } = useParams();
  const [searchParams] = useSearchParams();

  // TODO: make repoId dynamic from env/selection
  const repoId = "author-p131724-e1294209.adobeaemcloud.com";

  const [canonicalHtml, setCanonicalHtml] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");

  const [lastRenderResult, setLastRenderResult] = useState(null);

  const [lastBestHtml, setLastBestHtml] = useState("");
  const [lastSanitizedHtml, setLastSanitizedHtml] = useState("");

  const [templateName, setTemplateName] = useState("Baseline Clone");

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrbId, setSelectedPrbId] = useState(prbId || null);
  const [selectedPrb, setSelectedPrb] = useState(null);

  const [vfItems, setVfItems] = useState([]);
  const [contentOptions, setContentOptions] = useState([]);

  // Legacy selections (kept, but no longer required for “Add pattern”)
  const [selectedVfId, setSelectedVfId] = useState(null);
  const [selectedContentId, setSelectedContentId] = useState(null);

  const [modules, setModules] = useState([]);

  const [isUpdatingPrb, setIsUpdatingPrb] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const [renderError, setRenderError] = useState("");
  const [previewWarnings, setPreviewWarnings] = useState([]);

  // iframe runtime messages
  const [iframeMsgs, setIframeMsgs] = useState([]);

  const [showAdvanced, setShowAdvanced] = useState(searchParams.get("advanced") === "1");
  const [bindingStreamText, setBindingStreamText] = useState("[]");
  const [cacheText, setCacheText] = useState("{}");

  // Diagnostics gating
  const [enableIframeBridge, setEnableIframeBridge] = useState(searchParams.get("bridge") === "1");

  // Tabs
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

  // Operation queue
  const opQueueRef = useRef(Promise.resolve());
  function enqueue(asyncFn) {
    opQueueRef.current = opQueueRef.current
      .then(() => asyncFn())
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("Queued op failed:", e);
      });
    return opQueueRef.current;
  }

  // Iframe message listener (bridge)
  useEffect(() => {
    function onMessage(ev) {
      const msg = ev?.data;
      if (!msg || msg.__TS_PREVIEW__ !== true) return;

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

  // Load PRB list so we can show labels, and resolve selectedPrb
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

  // Load template HTML by templateId on entry (deep-link safe)
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

  useEffect(() => {
    // Deep-link entry: ensure we have PRB list + template loaded
    loadPrbList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function loadVfs() {
    const res = await actionWebInvoke(actions["ajo-vf-demo"], headers);
    setVfItems(res?.fragments || []);
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
      // eslint-disable-next-line no-console
      console.error("Load Content CFs failed:", e);
    }
  }

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

  // Add pattern first (VF only), then bind content inline.
  function addPattern(vfId) {
    if (!templateId) return;
    if (!vfId) return;
    if (!canonicalHtml) return;

    enqueue(async () => {
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
      setModules(nextModules);

      const nextHtml = appendPatternOnlyToTemplateHtml(canonicalHtml, {
        vfId,
        moduleId,
      });

      setCanonicalHtml(nextHtml);
    });
  }

  function bindContent(moduleId, contentId) {
    if (!templateId) return;
    if (!moduleId || !contentId) return;
    if (!canonicalHtml) return;

    const m = modules.find((x) => x.moduleId === moduleId);
    if (!m?.vfId) return;

    enqueue(async () => {
      const nextModules = modules.map((x) => (x.moduleId === moduleId ? { ...x, contentId } : x));
      setModules(nextModules);

      const nextHtml = bindContentInModuleHtml(canonicalHtml, {
        moduleId,
        vfId: m.vfId,
        aemCfId: contentId,
        repoId,
        vars: m.vars || { firstName: "" },
      });

      setCanonicalHtml(nextHtml);
    });
  }

  function removeModule(moduleId) {
    // UI-only for now (canonical HTML removal can be added later using markers)
    setModules((prev) => prev.filter((m) => m.moduleId !== moduleId));
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
      setPreviewHtml(bridged);

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
      // eslint-disable-next-line no-console
      console.error("Render preview failed:", e);
      setRenderError(e?.message || "Render failed");
      setPreviewWarnings([]);
      setPreviewHtml(stripAjoSyntax(canonicalHtml || "<html><body><p>Render failed.</p></body></html>"));
    } finally {
      setIsRendering(false);
    }
  }

  useEffect(() => {
    if (!canonicalHtml) return;

    const t = setTimeout(() => {
      renderPreview();
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalHtml]);

  // Diagnostics recompute on tab switch (unchanged behavior)
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

  const serverVfDiag = lastRenderResult?.vfDiag || null;
  const stitchReport = lastRenderResult?.stitchReport || null;
  const fragmentsResolvedAll = Array.isArray(lastRenderResult?.fragmentsResolvedAll)
    ? lastRenderResult.fragmentsResolvedAll
    : Array.isArray(lastRenderResult?.fragmentsResolved)
      ? lastRenderResult.fragmentsResolved
      : [];

  return (
    <View>
      <Flex justifyContent="space-between" alignItems="center" wrap>
        <View>
          <Heading level={2}>Template Studio</Heading>
          <Text UNSAFE_style={{ opacity: 0.85 }}>Step 3 of 3 — Compose deterministically: pick patterns, then bind data.</Text>
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

      {/* Global config bar */}
      <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
        <Flex gap="size-200" alignItems="end" wrap>
          <TextField label="Template name" value={templateName} onChange={setTemplateName} width="size-3600" />

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
        {/* Left: VF library (still useful as a reference) */}
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

        {/* Center: Composition timeline + Preview */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
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
            Add a pattern first, then bind content inline. This keeps composition deterministic (pattern + data).
          </Text>

          <Divider size="S" marginY="size-200" />

          <View height="size-2000" overflow="auto">
            {!modules.length ? (
              <Text UNSAFE_style={{ opacity: 0.85 }}>No modules yet. Add a pattern to start.</Text>
            ) : (
              modules.map((m, idx) => (
                <ModuleCard
                  key={m.moduleId}
                  module={m}
                  index={idx}
                  vfItems={vfItems}
                  contentOptions={contentOptions}
                  onBindContent={bindContent}
                  onRemove={removeModule}
                />
              ))
            )}
          </View>

          <Divider size="S" marginY="size-200" />

          <Tabs aria-label="Canvas Tabs" selectedKey={activeTab} onSelectionChange={setActiveTab}>
            <TabList>
              <Item key="preview">Preview</Item>
              <Item key="modules">Modules</Item>
              <Item key="html">AJO HTML</Item>
              <Item key="aem">AEM</Item>
              <Item key="diagnostics">Diagnostics</Item>
            </TabList>

            <TabPanels>
              <Item key="preview">
                <View borderWidth="thin" borderColor="light" borderRadius="small" height="42vh" padding="size-100">
                  {renderError ? (
                    <View marginBottom="size-100">
                      <StatusLight variant="negative">{renderError}</StatusLight>
                    </View>
                  ) : null}

                  <iframe
                    title="Email Preview"
                    style={{ width: "100%", height: "100%", border: "none" }}
                    sandbox="allow-same-origin allow-scripts"
                    srcDoc={previewHtml}
                  />
                </View>
              </Item>

              <Item key="modules">
                <View height="42vh" overflow="auto">
                  {!modules.length ? (
                    <Text>No modules yet.</Text>
                  ) : (
                    modules.map((m, idx) => (
                      <View key={m.moduleId} marginBottom="size-150">
                        <Text>
                          {idx + 1}. VF: {m.vfId || "(not paired)"} | CF: {m.contentId || "(unbound)"} | moduleId:{" "}
                          {m.moduleId}
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
                  height="42vh"
                  overflow="auto"
                >
                  <pre style={{ whiteSpace: "pre-wrap" }}>{canonicalHtml || "(empty)"}</pre>
                </View>
              </Item>

              <Item key="aem">
                <View height="42vh" overflow="auto">
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

              <Item key="diagnostics">
                <View height="42vh" overflow="auto">
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
                    <Divider size="S" marginY="size-100" />
                    <Flex gap="size-100">
                      <Button variant="secondary" onPress={() => setIframeMsgs([])}>
                        Clear iframe messages
                      </Button>
                      <Button
                        variant="secondary"
                        onPress={() => {
                          try {
                            navigator.clipboard.writeText(safeJson(iframeMsgs, 2));
                          } catch {
                            /* ignore */
                          }
                        }}
                        isDisabled={!iframeMsgs.length}
                      >
                        Copy iframe messages JSON
                      </Button>
                    </Flex>
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

                  <View marginBottom="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
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

                  <View marginBottom="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>Server render diagnostics</Heading>
                    <Divider size="S" marginY="size-100" />

                    {!lastRenderResult ? (
                      <Text UNSAFE_style={{ opacity: 0.85 }}>No render result yet. Render preview to populate.</Text>
                    ) : (
                      <View>
                        <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                          previewDiagnostics: {safeJson(serverPreviewDiagnostics, 2)}
                        </Text>

                        {serverDynamicRefs ? (
                          <View marginTop="size-150">
                            <Divider size="S" marginY="size-100" />
                            <Heading level={6}>Dynamic references</Heading>
                            <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                              wrapperInferred: {String(serverDynamicRefs.wrapperInferred ?? "")} • placeholdersSeen:
                              {String(serverDynamicRefs.totalPlaceholdersSeen ?? "")} • replacementsMade:
                              {String(serverDynamicRefs.totalReplacementsMade ?? "")} • uniqueRefs:
                              {String(serverDynamicRefs.totalUniqueReferences ?? "")}
                            </Text>
                            <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                              orderedReferenceNotes: {safeJson(serverDynamicRefs.orderedReferenceNotes || [], 0)}
                            </Text>
                            {!!(serverDynamicRefs.warnings && serverDynamicRefs.warnings.length) ? (
                              <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                                warnings: {safeJson(serverDynamicRefs.warnings.slice(0, 10), 2)}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    )}
                  </View>

                  <View marginBottom="size-200" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-150">
                    <Heading level={5}>Server stitching diagnostics</Heading>
                    <Divider size="S" marginY="size-100" />

                    {!lastRenderResult ? (
                      <Text UNSAFE_style={{ opacity: 0.85 }}>No render result yet. Render preview to populate.</Text>
                    ) : (
                      <View>
                        <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                          vfDiag: {safeJson(serverVfDiag, 2)}
                        </Text>
                        <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                          stitchReport: {safeJson(stitchReport, 2)}
                        </Text>
                        <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                          fragmentsResolvedAll(count): {Array.isArray(fragmentsResolvedAll) ? fragmentsResolvedAll.length : 0}
                        </Text>

                        {Array.isArray(fragmentsResolvedAll) && fragmentsResolvedAll.length ? (
                          <View marginTop="size-100">
                            <Divider size="S" marginY="size-100" />
                            {fragmentsResolvedAll.slice(0, 30).map((f, i) => (
                              <View key={`fr-${i}`} marginBottom="size-50">
                                <Text UNSAFE_style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                                  {f.id} — {f.name || "(unnamed)"} — hasContent={String(!!f.hasContent)}
                                </Text>
                              </View>
                            ))}
                            {fragmentsResolvedAll.length > 30 ? (
                              <Text UNSAFE_style={{ opacity: 0.8 }}>
                                Showing first 30 of {fragmentsResolvedAll.length}. See AEM tab “Raw render result” for full
                                payload.
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
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
                </View>
              </Item>
            </TabPanels>
          </Tabs>
        </View>

        {/* Right: Content CF library */}
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
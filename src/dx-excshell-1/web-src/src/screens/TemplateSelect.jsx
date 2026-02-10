// File: src/dx-excshell-1/web-src/src/screens/TemplateSelect.jsx

import React, { useContext, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Heading,
  View,
  Flex,
  Button,
  Text,
  ListView,
  Item,
  Divider,
  TextField,
  StatusLight,
  Grid,
} from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";
import { ImsContext } from "../context/ImsContext";

/**
 * Prevent “setState on unmounted component” warnings for async flows that navigate away.
 */
function useIsMounted() {
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return useCallback(() => mountedRef.current, []);
}

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

export function TemplateSelect() {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  const nav = useNavigate();
  const { prbId } = useParams();

  const isMounted = useIsMounted();

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrb, setSelectedPrb] = useState(null);

  const [templateName, setTemplateName] = useState("Baseline Clone");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  const [manualTemplateId, setManualTemplateId] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  const [isLoadingPrb, setIsLoadingPrb] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // NOTE: keep repoId consistent with Studio for now (even if not used on this screen yet)
  const repoId = "author-p131724-e1294209.adobeaemcloud.com";

  async function loadPrbList() {
    try {
      if (isMounted()) {
        setErr("");
        setIsLoadingPrb(true);
      }

      const res = await actionWebInvoke(actions["aem-prb-list"]);
      const items = res?.data?.prbPropertiesList?.items || [];

      if (!isMounted()) return;

      setPrbOptions(
        items.map((it) => ({
          id: it._id,
          label:
            it.prbNumber && it.name
              ? `${it.prbNumber} — ${it.name}`
              : it.name || it.prbNumber || it._path || it._id,
          raw: it,
        }))
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Load PRBs failed:", e);
      if (isMounted()) setErr(e?.message || "Failed to load PRBs");
    } finally {
      if (isMounted()) setIsLoadingPrb(false);
    }
  }

  async function loadTemplatesForPrb(prbObj) {
    // IMPORTANT: You may or may not have an action for this yet.
    // If actions["ajo-template-list"] exists, we’ll call it. Otherwise we show the manual-open fallback.
    const listAction = actions["ajo-template-list"];
    if (!listAction) {
      if (isMounted()) {
        setTemplates([]);
        setStatus("Template listing action not configured (ajo-template-list). Use “Open by Template ID” below.");
      }
      return;
    }

    try {
      if (isMounted()) {
        setErr("");
        setStatus("");
        setIsLoadingTemplates(true);
      }

      const prbNumber = prbObj?.raw?.prbNumber || null;

      // Expected contract (you can adjust your action to match):
      // input: { labels: ["PRB:1234"] }
      // output: { templates: [{ id, name, modifiedAt, labels }] }
      const res = await actionWebInvoke(listAction, headers, {
        labels: buildLabelsForPrb(prbNumber),
      });

      if (!isMounted()) return;

      const items = res?.templates || res?.items || [];

      setTemplates(
        (Array.isArray(items) ? items : [])
          .map((t) => ({
            id: t.id || t.templateId || t._id,
            name: t.name || t.title || t.label || "(unnamed)",
            raw: t,
          }))
          .filter((t) => !!t.id)
      );

      if (!items?.length) setStatus("No templates found for this PRB (or action returned no rows). You can create a new one.");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Load templates failed:", e);
      if (isMounted()) setErr(e?.message || "Failed to load templates");
    } finally {
      if (isMounted()) setIsLoadingTemplates(false);
    }
  }

  useEffect(() => {
    loadPrbList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!prbId || !prbOptions.length) return;
    const hit = prbOptions.find((p) => p.id === prbId) || null;

    // setSelectedPrb is safe here; component is mounted during effects
    setSelectedPrb(hit);

    if (hit) loadTemplatesForPrb(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prbId, prbOptions]);

  async function createFromBaselineAndOpen() {
    try {
      if (!selectedPrb) return;

      if (isMounted()) {
        setErr("");
        setStatus("");
        setIsCreating(true);
      }

      const prbNumber = selectedPrb?.raw?.prbNumber || null;

      const res = await actionWebInvoke(actions["ajo-template-create"], headers, {
        name: templateName,
        description: "Created from baseline via App Builder",
        createFromBaseline: true,
        prbNumber: prbNumber,
        prbName: selectedPrb?.raw?.name || null,
      });

      const templateId = res?.templateId;
      if (!templateId) {
        if (isMounted()) setErr("Template created but no templateId returned.");
        return;
      }

      // Navigate away. After this, TemplateSelect unmounts, so we MUST NOT set state.
      nav(`/prb/${encodeURIComponent(prbId)}/templates/${encodeURIComponent(templateId)}/studio`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Create-from-baseline failed:", e);
      if (isMounted()) setErr(e?.message || "Create failed");
    } finally {
      // Guard against unmount during navigation
      if (isMounted()) setIsCreating(false);
    }
  }

  function openSelectedTemplate() {
    if (!selectedTemplateId) return;
    nav(`/prb/${encodeURIComponent(prbId)}/templates/${encodeURIComponent(selectedTemplateId)}/studio`);
  }

  function openManualTemplate() {
    const tid = String(manualTemplateId || "").trim();
    if (!tid) return;
    nav(`/prb/${encodeURIComponent(prbId)}/templates/${encodeURIComponent(tid)}/studio`);
  }

  return (
    <View>
      <Heading level={2}>Template Studio</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Step 2 of 3 — Open an existing template tagged to this PRB, or create a new one from the enterprise baseline.
      </Text>

      <Divider size="S" marginY="size-200" />

      <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
        <Flex direction="column" gap="size-200">
          <Flex justifyContent="space-between" alignItems="center" wrap>
            <View>
              <Text UNSAFE_style={{ fontWeight: 600 }}>Selected PRB</Text>
              <Text UNSAFE_style={{ opacity: 0.85 }}>
                {selectedPrb?.label || prbId || "(none)"} {repoId ? `• repoId=${repoId}` : ""}
              </Text>
            </View>
            <Button variant="secondary" onPress={() => nav("/prb")}>
              Change PRB
            </Button>
          </Flex>

          <Divider size="S" />

          <Flex gap="size-200" alignItems="end" wrap>
            <TextField label="New template name" value={templateName} onChange={setTemplateName} width="size-3600" />
            <Button variant="cta" onPress={createFromBaselineAndOpen} isDisabled={!selectedPrb || isCreating}>
              {isCreating ? "Creating…" : "Create from baseline"}
            </Button>
          </Flex>

          {err ? <StatusLight variant="negative">{err}</StatusLight> : null}
          {status ? <StatusLight variant="info">{status}</StatusLight> : null}
        </Flex>
      </View>

      <Divider size="S" marginY="size-200" />

      <Grid columns={["2fr", "1fr"]} gap="size-200" height="70vh">
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Templates for PRB</Heading>
            <Flex gap="size-100" alignItems="center">
              <Button
                variant="secondary"
                onPress={() => selectedPrb && loadTemplatesForPrb(selectedPrb)}
                isDisabled={isLoadingTemplates || !selectedPrb}
              >
                {isLoadingTemplates ? "Loading…" : "Refresh"}
              </Button>
              <Button variant="primary" onPress={openSelectedTemplate} isDisabled={!selectedTemplateId}>
                Open
              </Button>
            </Flex>
          </Flex>

          <Divider size="S" marginY="size-150" />

          {!templates.length ? (
            <Text UNSAFE_style={{ opacity: 0.85 }}>
              {isLoadingTemplates ? "Loading templates…" : "No templates listed (or listing action not configured)."}
            </Text>
          ) : (
            <ListView
              aria-label="Templates"
              selectionMode="single"
              selectedKeys={selectedTemplateId ? [selectedTemplateId] : []}
              onSelectionChange={(keys) => setSelectedTemplateId([...keys][0])}
              height="60vh"
            >
              {templates.map((t) => (
                <Item key={t.id}>{t.name}</Item>
              ))}
            </ListView>
          )}
        </View>

        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Heading level={4}>Open by Template ID</Heading>
          <Text UNSAFE_style={{ opacity: 0.85 }}>
            Useful as a fallback if template listing isn’t available yet.
          </Text>

          <Divider size="S" marginY="size-150" />

          <TextField
            label="Template ID"
            placeholder="Paste templateId…"
            value={manualTemplateId}
            onChange={setManualTemplateId}
            width="100%"
          />
          <Button marginTop="size-150" variant="primary" onPress={openManualTemplate} isDisabled={!manualTemplateId.trim()}>
            Open
          </Button>
        </View>
      </Grid>
    </View>
  );
}
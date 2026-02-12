// File: src/dx-excshell-1/web-src/src/screens/TemplateSelect.jsx

import React, { useContext, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Heading,
  View,
  Flex,
  Button,
  Text,
  ComboBox,
  Item,
  Divider,
  TextField,
  StatusLight,
  DialogContainer,
  Dialog,
  Content,
  ButtonGroup,
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

export function TemplateSelect({ mode = "route", prbIdOverride, isDisabled = false, onOpenTemplate }) {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  const nav = useNavigate();
  const params = useParams();

  const prbId = mode === "embedded" ? prbIdOverride : params.prbId;

  const isMounted = useIsMounted();

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrb, setSelectedPrb] = useState(null);

  const [templateName, setTemplateName] = useState("Baseline Clone");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [templateMode, setTemplateMode] = useState(null); // "new" | "existing"
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);

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
          label: it.prbNumber && it.name ? `${it.prbNumber} — ${it.name}` : it.name || it.prbNumber || it._path || it._id,
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

    setSelectedPrb(hit);

    if (hit) loadTemplatesForPrb(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prbId, prbOptions]);

  async function createFromBaselineAndOpen() {
    try {
      if (!selectedPrb || !prbId) return;

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

      const newTemplateId = res?.templateId;
      if (!newTemplateId) {
        if (isMounted()) setErr("Template created but no templateId returned.");
        return;
      }

      if (mode === "embedded") {
        onOpenTemplate?.(newTemplateId);
        return;
      }

      nav(`/prb/${encodeURIComponent(prbId)}/templates/${encodeURIComponent(newTemplateId)}/studio`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Create-from-baseline failed:", e);
      if (isMounted()) setErr(e?.message || "Create failed");
    } finally {
      if (isMounted()) setIsCreating(false);
    }
  }

  function openTemplateId(tid) {
    if (!tid || !prbId) return;
    if (mode === "embedded") {
      onOpenTemplate?.(tid);
      return;
    }
    nav(`/prb/${encodeURIComponent(prbId)}/templates/${encodeURIComponent(tid)}/studio`);
  }

  async function createFromTemplateAndOpen() {
    try {
      if (!selectedPrb || !prbId || !selectedTemplateId) return;

      if (isMounted()) {
        setErr("");
        setStatus("");
        setIsCreating(true);
      }

      const prbNumber = selectedPrb?.raw?.prbNumber || null;

      const res = await actionWebInvoke(actions["ajo-template-create"], headers, {
        name: templateName,
        description: "Created from existing template via App Builder",
        createFromBaseline: true,
        baselineTemplateId: selectedTemplateId,
        prbNumber: prbNumber,
        prbName: selectedPrb?.raw?.name || null,
      });

      const newTemplateId = res?.templateId;
      if (!newTemplateId) {
        if (isMounted()) setErr("Template created but no templateId returned.");
        return;
      }

      if (mode === "embedded") {
        onOpenTemplate?.(newTemplateId);
        return;
      }

      nav(`/prb/${encodeURIComponent(prbId)}/templates/${encodeURIComponent(newTemplateId)}/studio`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Create-from-template failed:", e);
      if (isMounted()) setErr(e?.message || "Create failed");
    } finally {
      if (isMounted()) setIsCreating(false);
    }
  }

  return (
    <View UNSAFE_style={{ opacity: isDisabled ? 0.5 : 1, pointerEvents: isDisabled ? "none" : "auto" }} UNSAFE_className={mode === "embedded" ? "FlowCompact" : ""}>
      {mode !== "embedded" ? (
        <View>
          <Heading level={2}>Templates</Heading>
          <Text UNSAFE_style={{ opacity: 0.85 }}>Open an existing template for this PRB, or create a new one from baseline.</Text>
          <Divider size="S" marginY="size-200" />
        </View>
      ) : null}

      <View UNSAFE_className="FlowCompactCard">
        <Flex direction="column" gap="size-150">
          <Flex gap="size-150" alignItems="end" wrap justifyContent="center">
            <TextField label="New template name" value={templateName} onChange={setTemplateName} width="size-3600" />
            <Button
              variant="cta"
              onPress={() => {
                setTemplateMode("new");
                setConfirmAction({ type: "createFromBaseline" });
              }}
              isDisabled={!selectedPrb || isCreating || isDisabled}
            >
              {isCreating ? "Creating…" : "Create New Template"}
            </Button>
            <Button
              variant="secondary"
              onPress={() => setTemplateMode("existing")}
              isDisabled={!selectedPrb || isDisabled}
            >
              Choose Existing Template
            </Button>
          </Flex>

          <Text UNSAFE_style={{ opacity: 0.8 }}>
            Choose Existing Template to create a new version or view the current version.
          </Text>

          {err ? <StatusLight variant="negative">{err}</StatusLight> : null}
          {status ? <StatusLight variant="info">{status}</StatusLight> : null}
        </Flex>
      </View>

      {templateMode === "existing" ? (
        <View>
          <Divider size="S" marginY="size-150" />

          <View UNSAFE_className="FlowCompactCard">
            <Flex direction="column" gap="size-150">
              <ComboBox
                label="Template"
                placeholder={isLoadingTemplates ? "Loading…" : "Search template name…"}
                selectedKey={selectedTemplateId}
                onSelectionChange={(key) => setSelectedTemplateId(key)}
                width="100%"
                menuTrigger="focus"
                isDisabled={isLoadingTemplates || isDisabled}
              >
                {templates.map((t) => (
                  <Item key={t.id} textValue={t.name || t.id}>
                    {t.name || t.id}
                  </Item>
                ))}
              </ComboBox>

              {selectedTemplateId ? (
                <View>
                  <Text UNSAFE_style={{ opacity: 0.85, marginBottom: 8 }}>
                    Selected: {selectedTemplate?.name || selectedTemplateId}
                  </Text>
                  {selectedTemplate?.id ? (
                    <Text UNSAFE_style={{ opacity: 0.6, fontSize: 12, marginBottom: 8 }}>ID: {selectedTemplate.id}</Text>
                  ) : null}
                  <Flex gap="size-100" alignItems="center" wrap>
                    <Button
                      variant="primary"
                      onPress={() => setConfirmAction({ type: "createFromTemplate" })}
                      isDisabled={!selectedTemplateId || isCreating || isDisabled}
                    >
                      {isCreating ? "Creating…" : "Create New Version"}
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={() => setConfirmAction({ type: "openTemplate", templateId: selectedTemplateId })}
                      isDisabled={!selectedTemplateId || isDisabled}
                    >
                      View Current Version
                    </Button>
                  </Flex>
                  <Text UNSAFE_style={{ opacity: 0.7, fontSize: 12, marginTop: 8 }}>
                    Actions above rebuild the Studio workspace.
                  </Text>
                </View>
              ) : null}
            </Flex>
          </View>
        </View>
      ) : null}

      <DialogContainer onDismiss={() => setConfirmAction(null)}>
        {confirmAction ? (
          <Dialog>
            <Heading>Confirm Template Rebuild</Heading>
            <Content>
              This will rebuild the Studio workspace and may discard current changes. Continue?
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={() => setConfirmAction(null)}>
                No
              </Button>
              <Button
                variant="negative"
                onPress={async () => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  if (action?.type === "createFromBaseline") await createFromBaselineAndOpen();
                  if (action?.type === "createFromTemplate") await createFromTemplateAndOpen();
                  if (action?.type === "openTemplate") openTemplateId(action.templateId);
                }}
              >
                Yes
              </Button>
            </ButtonGroup>
          </Dialog>
        ) : null}
      </DialogContainer>
    </View>
  );
}
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

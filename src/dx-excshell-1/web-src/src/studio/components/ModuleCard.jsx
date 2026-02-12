// File: src/dx-excshell-1/web-src/src/studio/components/ModuleCard.jsx

import React, { useMemo, useState } from "react";
import { View, Flex, Text, Divider, ComboBox, Item, Button, DialogTrigger, ActionButton, TooltipTrigger, Tooltip } from "@adobe/react-spectrum";
import Edit from "@spectrum-icons/workflow/Edit";
import { PatternPickerDialog } from "./PatternPickerDialog";

function vfNameById(vfItems, vfId) {
  const hit = (vfItems || []).find((v) => v?.id === vfId);
  return hit?.name || vfId || "(unknown VF)";
}

function vfMetaById(vfItems, vfId) {
  return (vfItems || []).find((v) => v?.id === vfId) || null;
}

function applyLinkTemplate(template, vars = {}) {
  if (!template) return null;
  const raw = String(template || "").trim();
  if (!raw) return null;
  return raw.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const val = vars[key];
    return val == null ? "" : String(val);
  });
}

function normalizeVfId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  return s.toLowerCase().startsWith("ajo:") ? s.slice(4) : s;
}

function safeOpenNewTab(url) {
  if (!url) return;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // ignore
  }
}

function ExternalOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ModuleCard({
  module,
  index,
  vfItems,
  contentOptions,
  onBindContent,
  onChangePattern,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  isFocused,
  isPinned,
  deepLinkConfig,
  repoId,
}) {
  const [isEditingContent, setIsEditingContent] = useState(false);
  const name = vfNameById(vfItems, module?.vfId);
  const vfMeta = vfMetaById(vfItems, module?.vfId);
  const supportsCfBinding = vfMeta?.supportsCfBinding;
  const bindingMode = vfMeta?.bindingMode || null;
  const showBindUi = Boolean(module?.contentId) || supportsCfBinding !== false;
  const bindingHint = bindingMode === "prb-global" ? "Binding Inherited" : bindingMode === "none" ? "No Binding" : null;

  // If hydrated contentId is not in the loaded list yet, add a visible placeholder option.
  const options = useMemo(() => {
    const base = Array.isArray(contentOptions) ? contentOptions : [];
    const cid = module?.contentId || null;
    if (!cid) return base;

    const exists = base.some((o) => o?.id === cid);
    if (exists) return base;

    return [{ id: cid, label: `Unknown CF - ${cid}` }, ...base];
  }, [contentOptions, module?.contentId]);

  const selectedContent = useMemo(() => {
    const cid = module?.contentId || null;
    if (!cid) return null;
    return options.find((o) => o?.id === cid) || null;
  }, [module?.contentId, options]);

  const patternHref = useMemo(() => {
    if (vfMeta?.deepLinkUrl) return vfMeta.deepLinkUrl;
    const cleanVfId = normalizeVfId(module?.vfId);
    if (!cleanVfId) return null;
    const fromTemplate = applyLinkTemplate(deepLinkConfig?.vfTemplate, {
      id: cleanVfId,
      rawId: String(module?.vfId || ""),
      idEncoded: encodeURIComponent(cleanVfId),
      name: String(vfMeta?.name || ""),
    });
    if (fromTemplate) return fromTemplate;
    const base = String(deepLinkConfig?.vfBaseUrl || "").trim();
    if (!base) return null;
    try {
      const u = new URL(base);
      const p = String(u.pathname || "").replace(/\/+$/, "");
      u.pathname = `${p}/${encodeURIComponent(cleanVfId)}`;
      return u.toString();
    } catch {
      return null;
    }
  }, [deepLinkConfig?.vfBaseUrl, deepLinkConfig?.vfTemplate, module?.vfId, vfMeta?.deepLinkUrl, vfMeta?.name]);

  const contentHref = useMemo(() => {
    if (selectedContent?.deepLinkUrl) return selectedContent.deepLinkUrl;
    if (!selectedContent?.id) return null;
    const fromTemplate = applyLinkTemplate(deepLinkConfig?.cfTemplate, {
      id: String(selectedContent.id),
      path: String(selectedContent.path || ""),
      repoId: String(repoId || ""),
      idEncoded: encodeURIComponent(String(selectedContent.id || "")),
      pathEncoded: encodeURIComponent(String(selectedContent.path || "")),
      repoIdEncoded: encodeURIComponent(String(repoId || "")),
    });
    if (fromTemplate) return fromTemplate;
    const base = String(deepLinkConfig?.aemAuthor || "").trim();
    const path = String(selectedContent?.path || "").trim();
    if (!base || !path) return null;
    try {
      const u = new URL(base);
      u.pathname = `/assets.html${path}`;
      return u.toString();
    } catch {
      return null;
    }
  }, [deepLinkConfig?.aemAuthor, deepLinkConfig?.cfTemplate, repoId, selectedContent]);

  return (
    <View
      data-vf-id={module?.vfId || ""}
      borderWidth="thin"
      borderColor="light"
      borderRadius="small"
      padding="size-150"
      marginBottom="size-150"
      backgroundColor={isFocused ? "blue-50" : "gray-50"}
      tabIndex={0}
      UNSAFE_style={
        isFocused
          ? { boxShadow: "0 0 0 2px rgba(47, 111, 237, 0.35)", borderColor: "#2f6fed", position: "relative" }
          : { position: "relative" }
      }
    >
      <Flex
        justifyContent="space-between"
        alignItems="center"
        gap="size-200"
        UNSAFE_style={{
          background: isFocused ? "rgba(47,111,237,0.12)" : "#f2f4f8",
          border: isFocused ? "1px solid rgba(47,111,237,0.35)" : "1px solid #e3e7ef",
          borderRadius: 8,
          padding: "6px 10px",
        }}
      >
        <Text UNSAFE_style={{ fontWeight: 600 }}>
          Module {index + 1}
        </Text>
        {isPinned ? (
          <Text
            UNSAFE_style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#1f4fb6",
              background: "rgba(47,111,237,0.12)",
              border: "1px solid rgba(47,111,237,0.28)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            Focused
          </Text>
        ) : null}
      </Flex>

      <Divider size="S" marginY="size-100" />

      <View marginBottom="size-75">
        <Flex alignItems="center" gap="size-100" wrap>
          <Text>
            <strong>Pattern:</strong> {name}
          </Text>
          <DialogTrigger>
            <TooltipTrigger>
              <ActionButton isQuiet aria-label="Edit pattern" data-keep-module-focus="true">
                <Edit />
              </ActionButton>
              <Tooltip>Edit pattern</Tooltip>
            </TooltipTrigger>
            <PatternPickerDialog
              vfItems={vfItems}
              onSelect={(nextVfId) => onChangePattern?.(module.moduleId, nextVfId)}
              title="Change Pattern"
              description="Choose a different Visual Fragment for this module."
              confirmLabel="Apply Pattern"
            />
          </DialogTrigger>
          <TooltipTrigger>
            <ActionButton
              isQuiet
              aria-label="Open pattern in AJO"
              isDisabled={!patternHref}
              onPress={() => safeOpenNewTab(patternHref)}
              data-keep-module-focus="true"
            >
              <ExternalOpenIcon />
            </ActionButton>
            <Tooltip>{patternHref ? "Open pattern in AJO (new tab)" : "Pattern link unavailable"}</Tooltip>
          </TooltipTrigger>
        </Flex>
      </View>

      <View>
        <Flex alignItems="center" gap="size-100" wrap>
          <Text>
            <strong>Content:</strong> {selectedContent ? selectedContent.label : ""}
          </Text>
          {showBindUi ? (
            <>
              <TooltipTrigger>
                <ActionButton
                  isQuiet
                  aria-label="Edit content"
                  onPress={() => setIsEditingContent((v) => !v)}
                  data-keep-module-focus="true"
                >
                  <Edit />
                </ActionButton>
                <Tooltip>Edit content</Tooltip>
              </TooltipTrigger>
              <TooltipTrigger>
                <ActionButton
                  isQuiet
                  aria-label="Open content in AEM"
                  isDisabled={!contentHref}
                  onPress={() => safeOpenNewTab(contentHref)}
                  data-keep-module-focus="true"
                >
                  <ExternalOpenIcon />
                </ActionButton>
                <Tooltip>{contentHref ? "Open content in AEM (new tab)" : "Content link unavailable"}</Tooltip>
              </TooltipTrigger>
            </>
          ) : null}
          {!showBindUi && bindingHint ? (
            <View
              UNSAFE_style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#3b4a66",
                background: "#f3f6fb",
                border: "1px solid #d7e1f1",
                borderRadius: 999,
                padding: "4px 10px",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#6a86b9",
                  display: "inline-block",
                }}
              />
              {bindingHint}
            </View>
          ) : null}
        </Flex>

        {showBindUi && isEditingContent ? (
          <Flex alignItems="end" gap="size-100" wrap>
            <ComboBox
              label="Bind Content Fragment"
              placeholder="Select content..."
              selectedKey={module?.contentId || null}
              onSelectionChange={(key) => {
                onBindContent(module.moduleId, key);
                setIsEditingContent(false);
              }}
              width="size-4600"
              menuTrigger="focus"
              data-keep-module-focus="true"
            >
              {options.map((cf) => (
                <Item key={cf.id}>{cf.label}</Item>
              ))}
            </ComboBox>
            <Button variant="secondary" isQuiet onPress={() => setIsEditingContent(false)} data-keep-module-focus="true">
              Done
            </Button>
          </Flex>
        ) : null}
      </View>

      <Flex justifyContent="space-between" marginTop="size-100" gap="size-100" alignItems="center">
        <Flex gap="size-100">
          <Button variant="secondary" onPress={() => onMoveUp(module.moduleId)} isDisabled={!canMoveUp}>
            Move up
          </Button>
          <Button variant="secondary" onPress={() => onMoveDown(module.moduleId)} isDisabled={!canMoveDown}>
            Move down
          </Button>
        </Flex>
        <Button variant="secondary" onPress={() => onRemove(module.moduleId)}>
          Remove
        </Button>
      </Flex>

    </View>
  );
}

// File: src/dx-excshell-1/web-src/src/studio/components/ModuleCard.jsx

import React, { useMemo } from "react";
import { View, Flex, Text, Divider, ComboBox, Item, Button } from "@adobe/react-spectrum";

function vfNameById(vfItems, vfId) {
  const hit = (vfItems || []).find((v) => v?.id === vfId);
  return hit?.name || vfId || "(unknown VF)";
}

function vfMetaById(vfItems, vfId) {
  return (vfItems || []).find((v) => v?.id === vfId) || null;
}

export function ModuleCard({
  module,
  index,
  vfItems,
  contentOptions,
  onBindContent,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  isFocused,
  isPinned,
}) {
  const name = vfNameById(vfItems, module?.vfId);
  const vfMeta = vfMetaById(vfItems, module?.vfId);
  const supportsCfBinding = vfMeta?.supportsCfBinding;
  const bindingMode = vfMeta?.bindingMode || null;
  const showBindCombo = Boolean(module?.contentId) || supportsCfBinding !== false;
  const bindingHint = bindingMode === "prb-global" ? "Binding Inherited" : bindingMode === "none" ? "No Binding" : null;

  // If hydrated contentId isn’t in the loaded list yet, add a visible placeholder option.
  const options = useMemo(() => {
    const base = Array.isArray(contentOptions) ? contentOptions : [];
    const cid = module?.contentId || null;
    if (!cid) return base;

    const exists = base.some((o) => o?.id === cid);
    if (exists) return base;

    return [{ id: cid, label: `Unknown CF — ${cid}` }, ...base];
  }, [contentOptions, module?.contentId]);

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
          ? { boxShadow: "0 0 0 2px rgba(47, 111, 237, 0.35)", borderColor: "#2f6fed" }
          : undefined
      }
    >
      <Flex justifyContent="space-between" alignItems="center" gap="size-200">
        <Text UNSAFE_style={{ fontWeight: 600 }}>
          {index + 1}. {name}
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

      {showBindCombo ? (
        <ComboBox
          label="Bind Content Fragment"
          placeholder="Select content…"
          selectedKey={module?.contentId || null}
          onSelectionChange={(key) => onBindContent(module.moduleId, key)}
          width="size-4600"
          menuTrigger="focus"
        >
          {options.map((cf) => (
            <Item key={cf.id}>{cf.label}</Item>
          ))}
        </ComboBox>
      ) : bindingHint ? (
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

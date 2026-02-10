// File: src/dx-excshell-1/web-src/src/studio/components/ModuleCard.jsx

import React, { useMemo } from "react";
import { View, Flex, Text, Divider, ComboBox, Item, StatusLight, Button } from "@adobe/react-spectrum";

function vfNameById(vfItems, vfId) {
  const hit = (vfItems || []).find((v) => v?.id === vfId);
  return hit?.name || vfId || "(unknown VF)";
}

export function ModuleCard({ module, index, vfItems, contentOptions, onBindContent, onRemove }) {
  const name = vfNameById(vfItems, module?.vfId);

  const status = module?.contentId ? (
    <StatusLight variant="positive">Bound</StatusLight>
  ) : (
    <StatusLight variant="negative">Unbound</StatusLight>
  );

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
      borderWidth="thin"
      borderColor="light"
      borderRadius="small"
      padding="size-150"
      marginBottom="size-150"
      backgroundColor="gray-50"
    >
      <Flex justifyContent="space-between" alignItems="center" gap="size-200">
        <Text UNSAFE_style={{ fontWeight: 600 }}>
          {index + 1}. {name}
        </Text>
        {status}
      </Flex>

      <Divider size="S" marginY="size-100" />

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

      <Flex justifyContent="end" marginTop="size-100">
        <Button variant="secondary" onPress={() => onRemove(module.moduleId)}>
          Remove
        </Button>
      </Flex>
    </View>
  );
}
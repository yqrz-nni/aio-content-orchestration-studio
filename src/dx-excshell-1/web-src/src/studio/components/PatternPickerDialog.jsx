// File: src/dx-excshell-1/web-src/src/studio/components/PatternPickerDialog.jsx

import React, { useState } from "react";
import { Heading, Text, Divider, ListView, Item, Button, ButtonGroup, Dialog, Content, StatusLight } from "@adobe/react-spectrum";
import { useDialogContainer } from "@react-spectrum/dialog";

export function PatternPickerDialog({
  vfItems,
  onSelect,
  title = "Add pattern",
  description = "Choose a Visual Fragment pattern. You can bind content after it's added.",
  confirmLabel = "Add",
}) {
  const [selected, setSelected] = useState(null);
  const dialog = useDialogContainer();

  const hasItems = Array.isArray(vfItems) && vfItems.length > 0;

  return (
    <Dialog>
      <Heading>{title}</Heading>
      <Content>
        <Text UNSAFE_style={{ opacity: 0.85 }}>{description}</Text>

        <Divider size="S" marginY="size-150" />

        {!hasItems ? (
          <StatusLight variant="negative">
            No patterns available yet. (VFs are loaded automatically; if this persists, check the vf action response.)
          </StatusLight>
        ) : (
          <ListView
            aria-label="Patterns"
            selectionMode="single"
            selectedKeys={selected ? [selected] : []}
            onSelectionChange={(keys) => setSelected([...keys][0])}
            height="size-3600"
          >
            {vfItems.map((vf) => (
              <Item key={vf.id}>{vf.name}</Item>
            ))}
          </ListView>
        )}
      </Content>

      <ButtonGroup>
        <Button variant="secondary" onPress={() => dialog.dismiss()}>
          Cancel
        </Button>
        <Button
          variant="cta"
          isDisabled={!hasItems || !selected}
          onPress={() => {
            if (!selected) return;
            onSelect(selected);
            dialog.dismiss();
          }}
        >
          {confirmLabel}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
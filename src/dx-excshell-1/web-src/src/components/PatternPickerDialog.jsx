// File: src/dx-excshell-1/web-src/src/studio/components/PatternPickerDialog.jsx

import React, { useState } from "react";
import { Heading, Text, Divider, ListView, Item, Button, ButtonGroup, Dialog, Content } from "@adobe/react-spectrum";

export function PatternPickerDialog({ vfItems, onSelect, close }) {
  const [selected, setSelected] = useState(null);

  return (
    <Dialog>
      <Heading>Add pattern</Heading>
      <Content>
        <Text UNSAFE_style={{ opacity: 0.85 }}>Choose a Visual Fragment pattern. You can bind content after it’s added.</Text>
        <Divider size="S" marginY="size-150" />
        <ListView
          aria-label="Patterns"
          selectionMode="single"
          selectedKeys={selected ? [selected] : []}
          onSelectionChange={(keys) => setSelected([...keys][0])}
          height="size-3600"
        >
          {(vfItems || []).map((vf) => (
            <Item key={vf.id}>{vf.name}</Item>
          ))}
        </ListView>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={close}>
          Cancel
        </Button>
        <Button
          variant="cta"
          isDisabled={!selected}
          onPress={() => {
            if (!selected) return;
            onSelect(selected);
            close();
          }}
        >
          Add
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
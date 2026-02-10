// File: src/dx-excshell-1/web-src/src/screens/TemplateFlow.jsx
//
// Single-screen “progressive reveal” flow:
// - Select PRB
// - Create/open template
// - Compose in Studio (embedded)
// Keeps deep links intact elsewhere; this is just a UX wrapper.

import React, { useMemo, useState } from "react";
import { View, Divider } from "@adobe/react-spectrum";

import { PrbSelect } from "./PrbSelect";
import { TemplateSelect } from "./TemplateSelect";
import { TemplateStudio } from "./TemplateStudio";

export function TemplateFlow() {
  // local flow state (no routing required)
  const [prbId, setPrbId] = useState(null);
  const [templateId, setTemplateId] = useState(null);

  const hasPrb = !!prbId;
  const hasTemplate = !!templateId;

  const studioKey = useMemo(() => `${prbId || ""}:${templateId || ""}`, [prbId, templateId]);

  return (
    <View>
      {/* Step 1: PRB */}
      <PrbSelect
        mode="embedded"
        value={prbId}
        onChange={(next) => {
          setPrbId(next || null);
          setTemplateId(null); // reset downstream
        }}
      />

      <Divider size="S" marginY="size-200" />

      {/* Step 2: Template list / create */}
      <TemplateSelect
        mode="embedded"
        prbIdOverride={prbId}
        isDisabled={!hasPrb}
        onOpenTemplate={(tid) => setTemplateId(tid || null)}
      />

      <Divider size="S" marginY="size-200" />

      {/* Step 3: Studio */}
      {hasPrb && hasTemplate ? (
        <TemplateStudio mode="embedded" prbIdOverride={prbId} templateIdOverride={templateId} key={studioKey} />
      ) : (
        <View />
      )}
    </View>
  );
}
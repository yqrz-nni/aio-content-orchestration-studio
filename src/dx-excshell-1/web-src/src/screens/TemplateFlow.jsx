// File: src/dx-excshell-1/web-src/src/screens/TemplateFlow.jsx
//
// Single-screen “progressive reveal” flow:
// - Select PRB
// - Create/open template
// - Compose in Studio (embedded)
// Keeps deep links intact elsewhere; this is just a UX wrapper.

import React, { useMemo, useState } from "react";
import { View, Divider, Flex, Text, Button } from "@adobe/react-spectrum";

import { PrbSelect } from "./PrbSelect";
import { TemplateSelect } from "./TemplateSelect";
import { TemplateStudio } from "./TemplateStudio";

export function TemplateFlow() {
  // local flow state (no routing required)
  const [prbId, setPrbId] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [openStep, setOpenStep] = useState("prb");

  const hasPrb = !!prbId;
  const hasTemplate = !!templateId;

  const studioKey = useMemo(() => `${prbId || ""}:${templateId || ""}`, [prbId, templateId]);

  function open(step) {
    setOpenStep(step);
  }

  return (
    <View>
      <View UNSAFE_className="FlowAccordion">
        {/* Step 1: PRB */}
        <View UNSAFE_className={`FlowSection ${openStep === "prb" ? "is-open" : ""}`}>
          <Flex justifyContent="space-between" alignItems="center" UNSAFE_className="FlowHeader">
            <View>
              <Text UNSAFE_className="FlowTitle">1. PRB Properties</Text>
              <Text UNSAFE_className="FlowHint">Choose the global PRB context to start.</Text>
            </View>
            <Button variant="secondary" onPress={() => open("prb")}>
              {openStep === "prb" ? "Open" : "Edit"}
            </Button>
          </Flex>
          {openStep === "prb" ? (
            <View UNSAFE_className="FlowBody">
              <PrbSelect
                mode="embedded"
                value={prbId}
                onChange={(next) => {
                  setPrbId(next || null);
                  setTemplateId(null); // reset downstream
                  if (next) open("template");
                }}
              />
            </View>
          ) : (
            <View UNSAFE_className="FlowSummary">
              <Text>{hasPrb ? prbId : "No PRB selected yet."}</Text>
            </View>
          )}
        </View>

        <Divider size="S" marginY="size-200" />

        {/* Step 2: Template list / create */}
        <View UNSAFE_className={`FlowSection ${openStep === "template" ? "is-open" : ""} ${!hasPrb ? "is-disabled" : ""}`}>
          <Flex justifyContent="space-between" alignItems="center" UNSAFE_className="FlowHeader" wrap>
            <View>
              <Text UNSAFE_className="FlowTitle">2. Template</Text>
              <Text UNSAFE_className="FlowHint">Open or create a template for this PRB.</Text>
            </View>
            <Flex gap="size-100" alignItems="center">
              {hasPrb ? (
                <Button variant="secondary" onPress={() => open("prb")}>
                  Edit PRB
                </Button>
              ) : null}
              <Button variant="secondary" onPress={() => open("template")} isDisabled={!hasPrb}>
              {openStep === "template" ? "Open" : "Edit"}
              </Button>
            </Flex>
          </Flex>
          {openStep === "template" ? (
            <View UNSAFE_className="FlowBody">
              <TemplateSelect
                mode="embedded"
                prbIdOverride={prbId}
                isDisabled={!hasPrb}
                onOpenTemplate={(tid) => {
                  setTemplateId(tid || null);
                  if (tid) open("studio");
                }}
              />
            </View>
          ) : (
            <View UNSAFE_className="FlowSummary">
              <Text>{hasTemplate ? templateId : "No template selected yet."}</Text>
            </View>
          )}
        </View>

        <Divider size="S" marginY="size-200" />

        {/* Step 3: Studio */}
        <View UNSAFE_className={`FlowSection ${openStep === "studio" ? "is-open" : ""} ${!hasTemplate ? "is-disabled" : ""}`}>
          <Flex justifyContent="space-between" alignItems="center" UNSAFE_className="FlowHeader">
            <View>
              <Text UNSAFE_className="FlowTitle">3. Studio</Text>
              <Text UNSAFE_className="FlowHint">Compose with Visual Fragments and AEM Content Fragments.</Text>
            </View>
            <Button variant="secondary" onPress={() => open("studio")} isDisabled={!hasTemplate}>
              {openStep === "studio" ? "Open" : "Edit"}
            </Button>
          </Flex>
          {openStep === "studio" ? (
            <View UNSAFE_className="FlowBody">
              {hasPrb && hasTemplate ? (
                <TemplateStudio mode="embedded" prbIdOverride={prbId} templateIdOverride={templateId} key={studioKey} />
              ) : (
                <View />
              )}
            </View>
          ) : (
            <View UNSAFE_className="FlowSummary">
              <Text>{hasTemplate ? "Ready to edit." : "Select a template to continue."}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// File: src/dx-excshell-1/web-src/src/screens/PrbSelect.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heading, View, Flex, Button, Text, ComboBox, Item, StatusLight, Divider } from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";

function toPrbLabel(it) {
  const displayName = it?.name || it?.prbNumber || it?._path || it?._id;
  return it?.prbNumber && it?.name ? `${it.prbNumber} — ${it.name}` : displayName;
}

export function PrbSelect() {
  const nav = useNavigate();

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrbId, setSelectedPrbId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [err, setErr] = useState("");

  const selectedPrb = useMemo(() => prbOptions.find((o) => o.id === selectedPrbId) || null, [prbOptions, selectedPrbId]);

  async function loadPrbList() {
    try {
      setErr("");
      setIsLoading(true);
      const res = await actionWebInvoke(actions["aem-prb-list"]);
      const items = res?.data?.prbPropertiesList?.items || [];
      setPrbOptions(
        items.map((it) => ({
          id: it._id,
          label: toPrbLabel(it),
          raw: it,
        }))
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Load PRBs failed:", e);
      setErr(e?.message || "Failed to load PRBs");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eager load
    loadPrbList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function continueToTemplates() {
    if (!selectedPrbId) return;
    nav(`/prb/${encodeURIComponent(selectedPrbId)}/templates`);
  }

  return (
    <View>
      <Heading level={2}>Template Studio</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Step 1 of 3 — Select a PRB Properties context (brand / styles / global configuration).
      </Text>

      <Divider size="S" marginY="size-200" />

      <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200" maxWidth="size-6000">
        <Flex direction="column" gap="size-150">
          <Flex gap="size-200" alignItems="end" wrap>
            <ComboBox
              label="PRB Properties"
              placeholder={isLoading ? "Loading…" : "Search PRB number or name…"}
              selectedKey={selectedPrbId}
              onSelectionChange={(key) => setSelectedPrbId(key)}
              width="size-4600"
              menuTrigger="focus"
              isDisabled={isLoading}
            >
              {prbOptions.map((o) => (
                <Item key={o.id}>{o.label}</Item>
              ))}
            </ComboBox>

            <Button variant="secondary" onPress={loadPrbList} isDisabled={isLoading}>
              {isLoading ? "Loading…" : "Refresh"}
            </Button>

            <Button variant="cta" onPress={continueToTemplates} isDisabled={!selectedPrbId}>
              Continue
            </Button>
          </Flex>

          {err ? (
            <StatusLight variant="negative">{err}</StatusLight>
          ) : selectedPrbId ? (
            <StatusLight variant="positive">
              Selected: {selectedPrb?.label || selectedPrbId}
            </StatusLight>
          ) : (
            <StatusLight variant="negative">No PRB selected</StatusLight>
          )}

          <Text UNSAFE_style={{ opacity: 0.8 }}>
            This selection drives template labels (e.g. <code>PRB:&lt;number&gt;</code>) and the global PRB binding in the HTML.
          </Text>
        </Flex>
      </View>
    </View>
  );
}
// File: src/dx-excshell-1/web-src/src/screens/PrbSelect.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heading, View, Flex, Button, Text, ComboBox, Item, StatusLight, Divider } from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";

function toPrbOption(it) {
  const prbNumber = it?.prbNumber || "";
  const name = it?.name || "";
  const fallback = it?._path || it?._id || "(unknown)";

  const label = prbNumber && name ? `${prbNumber} — ${name}` : name || prbNumber || fallback;

  return {
    id: it._id,
    label,
    prbNumber: prbNumber || "",
    name: name || "",
    raw: it,
  };
}

export function PrbSelect({ mode = "route", value, onChange }) {
  const nav = useNavigate();

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrbId, setSelectedPrbId] = useState(value || null);
  const [isLoading, setIsLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    // keep internal state in sync when used embedded
    if (mode === "embedded") setSelectedPrbId(value || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode]);

  const selectedPrb = useMemo(() => prbOptions.find((o) => o.id === selectedPrbId) || null, [prbOptions, selectedPrbId]);

  async function loadPrbList() {
    try {
      setErr("");
      setIsLoading(true);
      const res = await actionWebInvoke(actions["aem-prb-list"]);
      const items = res?.data?.prbPropertiesList?.items || [];
      setPrbOptions(items.map((it) => toPrbOption(it)));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Load PRBs failed:", e);
      setErr(e?.message || "Failed to load PRBs");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadPrbList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function proceed() {
    if (!selectedPrbId) return;
    if (mode === "embedded") {
      onChange?.(selectedPrbId);
      return;
    }
    nav(`/prb/${encodeURIComponent(selectedPrbId)}/templates`);
  }

  return (
    <View>
      <Heading level={2}>Template Studio</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>Choose a PRB Properties context to begin.</Text>

      <Divider size="S" marginY="size-200" />

      <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200" maxWidth="size-6000">
        <Flex direction="column" gap="size-150">
          <Flex gap="size-200" alignItems="end" wrap>
            <ComboBox
              label="PRB Properties"
              placeholder={isLoading ? "Loading…" : "Search PRB number or name…"}
              selectedKey={selectedPrbId}
              onSelectionChange={(key) => {
                setSelectedPrbId(key);
                if (mode === "embedded") onChange?.(key);
              }}
              width="size-6000"
              menuTrigger="focus"
              isDisabled={isLoading}
            >
              {prbOptions.map((o) => (
                <Item key={o.id}>
                  <Flex direction="column" gap="size-0">
                    <Text UNSAFE_style={{ fontWeight: 600 }}>{o.prbNumber || o.label}</Text>
                    {o.name ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 12 }}>{o.name}</Text> : null}
                  </Flex>
                </Item>
              ))}
            </ComboBox>

            <Button variant="secondary" onPress={loadPrbList} isDisabled={isLoading}>
              {isLoading ? "Loading…" : "Refresh"}
            </Button>

            <Button variant="cta" onPress={proceed} isDisabled={!selectedPrbId}>
              Continue
            </Button>
          </Flex>

          {err ? (
            <StatusLight variant="negative">{err}</StatusLight>
          ) : selectedPrbId ? (
            <StatusLight variant="positive">Selected: {selectedPrb?.label || selectedPrbId}</StatusLight>
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
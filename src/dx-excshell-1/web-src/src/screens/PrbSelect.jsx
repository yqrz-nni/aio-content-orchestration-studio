// File: src/dx-excshell-1/web-src/src/screens/PrbSelect.jsx

import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heading, View, Flex, Button, Text, ComboBox, Item, StatusLight, Divider, ActionButton, TooltipTrigger, Tooltip } from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";
import { ImsContext } from "../context/ImsContext";

function toPrbOption(it) {
  const prbNumber = it?.prbNumber || "";
  const name = it?.name || "";
  const fallback = it?._path || it?._id || "(unknown)";

  const label = prbNumber && name ? `${prbNumber} - ${name}` : name || prbNumber || fallback;

  return {
    id: it._id,
    label,
    prbNumber: prbNumber || "",
    name: name || "",
    path: it?._path || "",
    deepLinkUrl: it?.deepLinkUrl || null,
    raw: it,
  };
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

export function PrbSelect({ mode = "route", value, onChange, onSelect }) {
  const ims = useContext(ImsContext);
  const headers = useMemo(
    () => ({
      Authorization: ims?.token?.startsWith("Bearer ") ? ims.token : `Bearer ${ims?.token}`,
      "x-gw-ims-org-id": ims?.org,
    }),
    [ims]
  );
  const nav = useNavigate();

  const [prbOptions, setPrbOptions] = useState([]);
  const [selectedPrbId, setSelectedPrbId] = useState(value || null);
  const [isLoading, setIsLoading] = useState(false);
  const [err, setErr] = useState("");
  const [deepLinkConfig, setDeepLinkConfig] = useState({ cfDetailUrlPrefix: null });

  useEffect(() => {
    // keep internal state in sync when used embedded
    if (mode === "embedded") setSelectedPrbId(value || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode]);

  const selectedPrb = useMemo(() => prbOptions.find((o) => o.id === selectedPrbId) || null, [prbOptions, selectedPrbId]);
  const selectedPrbHref = useMemo(() => {
    if (!selectedPrb?.id) return null;
    const prefix = String(deepLinkConfig?.cfDetailUrlPrefix || "").trim();
    if (prefix) return `${prefix}${encodeURIComponent(String(selectedPrb.id))}`;
    if (selectedPrb?.deepLinkUrl) return selectedPrb.deepLinkUrl;
    return null;
  }, [deepLinkConfig?.cfDetailUrlPrefix, selectedPrb]);

  async function loadPrbList() {
    try {
      setErr("");
      setIsLoading(true);
      const res = await actionWebInvoke(actions["aem-prb-list"], headers);
      const items = res?.data?.prbPropertiesList?.items || [];
      setPrbOptions(items.map((it) => toPrbOption(it)));
      setDeepLinkConfig({ cfDetailUrlPrefix: res?.deepLinkConfig?.cfDetailUrlPrefix || null });
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
    const prbObj = prbOptions.find((o) => o.id === selectedPrbId) || null;
    if (mode === "embedded") {
      onChange?.(selectedPrbId);
      onSelect?.(prbObj);
      return;
    }
    nav(`/prb/${encodeURIComponent(selectedPrbId)}/templates`);
  }

  return (
    <View UNSAFE_className={mode === "embedded" ? "FlowCompact" : ""}>
      {mode !== "embedded" ? (
        <View>
          <Heading level={2}>PRB Selection</Heading>
          <Text UNSAFE_style={{ opacity: 0.85 }}>Choose a PRB Properties context to begin.</Text>
          <Divider size="S" marginY="size-200" />
        </View>
      ) : null}

      <View UNSAFE_className="FlowCompactCard" maxWidth="size-6000">
        <Flex direction="column" gap="size-100">
          <Flex gap="size-150" alignItems="end" wrap justifyContent="center">
            <ComboBox
              label={mode === "embedded" ? "PRB" : "PRB Properties"}
              placeholder={isLoading ? "Loading..." : "Search PRB number or name..."}
              selectedKey={selectedPrbId}
              onSelectionChange={(key) => {
                setSelectedPrbId(key);
              }}
              width="size-6000"
              menuTrigger="focus"
              isDisabled={isLoading}
            >
              {prbOptions.map((o) => (
                <Item key={o.id} textValue={o.label || o.prbNumber || o.id}>
                  {o.label || o.prbNumber || o.id}
                </Item>
              ))}
            </ComboBox>

            <Button variant="secondary" onPress={loadPrbList} isDisabled={isLoading}>
              {isLoading ? "Loading..." : "Refresh"}
            </Button>

            <Button variant="cta" onPress={proceed} isDisabled={!selectedPrbId}>
              Continue
            </Button>
            <TooltipTrigger>
              <ActionButton
                isQuiet
                aria-label="Open PRB in AEM"
                isDisabled={!selectedPrbHref}
                onPress={() => safeOpenNewTab(selectedPrbHref)}
              >
                <ExternalOpenIcon />
              </ActionButton>
              <Tooltip>{selectedPrbHref ? "Open PRB in AEM (new tab)" : "PRB link unavailable"}</Tooltip>
            </TooltipTrigger>
          </Flex>

          {err ? (
            <StatusLight variant="negative">{err}</StatusLight>
          ) : !deepLinkConfig?.cfDetailUrlPrefix ? (
            <StatusLight variant="info">
              PRB deep-link prefix missing (`AEM_CF_DETAIL_URL_PREFIX`), so external-link action may be disabled.
            </StatusLight>
          ) : selectedPrbId ? (
            <StatusLight variant="positive">Selected: {selectedPrb?.label || selectedPrbId}</StatusLight>
          ) : null}
        </Flex>
      </View>
    </View>
  );
}

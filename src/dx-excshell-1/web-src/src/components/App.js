import React, { useMemo, useState } from "react";
import {
  Provider,
  defaultTheme,
  Flex,
  View,
  Heading,
  Text,
  Button,
  ButtonGroup,
  Divider,
  Content,
  Well,
  ProgressCircle
} from "@adobe/react-spectrum";

/**
 * Minimal, clean App.js for an App Builder Experience Cloud Shell SPA.
 * - No tutorial components
 * - Simple "Connectivity" area you can extend
 *
 * Assumes your Runtime actions are exposed under /api/* (typical App Builder dev/proxy setup).
 */

async function callApi(path) {
  const res = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave as null; we'll show raw text
  }

  return {
    ok: res.ok,
    status: res.status,
    json,
    text
  };
}

function ResultPanel({ title, result }) {
  if (!result) return null;

  const payload =
    result.json != null ? JSON.stringify(result.json, null, 2) : result.text;

  return (
    <Well marginTop="size-200">
      <Flex direction="column" gap="size-100">
        <Flex alignItems="center" justifyContent="space-between">
          <Text UNSAFE_style={{ fontWeight: 600 }}>{title}</Text>
          <Text>
            {result.ok ? "✅" : "❌"} {result.status}
          </Text>
        </Flex>
        <View
          borderWidth="thin"
          borderColor="dark"
          borderRadius="small"
          padding="size-200"
          backgroundColor="gray-75"
          UNSAFE_style={{ maxHeight: 320, overflow: "auto", fontFamily: "monospace", fontSize: 12 }}
        >
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{payload}</pre>
        </View>
      </Flex>
    </Well>
  );
}

export default function App() {
  const [loadingKey, setLoadingKey] = useState(null);
  const [results, setResults] = useState({
    health: null,
    aem: null,
    ajo: null
  });

  const endpoints = useMemo(
    () => ({
      health: "/api/health",
      aem: "/api/aem/listUnifiedPromos", // change to /api/aem/listUnifiedPromos when you add it
      ajo: "/api/ajo/ping"
    }),
    []
  );

  async function runCheck(key) {
    try {
      setLoadingKey(key);
      const r = await callApi(endpoints[key]);
      setResults((prev) => ({ ...prev, [key]: r }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [key]: { ok: false, status: 0, json: { error: e?.message || String(e) }, text: "" }
      }));
    } finally {
      setLoadingKey(null);
    }
  }

  const anyLoading = loadingKey !== null;

  return (
    <Provider theme={defaultTheme} colorScheme="light">
      <View padding="size-300">
        <Flex direction="column" gap="size-200">
          <Heading level={2}>Content Orchestration Studio</Heading>
          <Text>Connectivity checks (Runtime → AEM Author GraphQL → AJO)</Text>

          <Divider />

          <Content>
            <Flex direction="column" gap="size-200">
              <Flex alignItems="center" gap="size-200">
                <ButtonGroup>
                  <Button
                    variant="primary"
                    onPress={() => runCheck("health")}
                    isDisabled={anyLoading}
                  >
                    Test Runtime Health
                  </Button>
                  <Button
                    variant="secondary"
                    onPress={() => runCheck("aem")}
                    isDisabled={anyLoading}
                  >
                    Test AEM
                  </Button>
                  <Button
                    variant="secondary"
                    onPress={() => runCheck("ajo")}
                    isDisabled={anyLoading}
                  >
                    Test AJO
                  </Button>
                </ButtonGroup>

                {anyLoading && (
                  <Flex alignItems="center" gap="size-100">
                    <ProgressCircle size="S" aria-label="Running check" isIndeterminate />
                    <Text>Running: {loadingKey}</Text>
                  </Flex>
                )}
              </Flex>

              <ResultPanel title="Runtime Health" result={results.health} />
              <ResultPanel title="AEM" result={results.aem} />
              <ResultPanel title="AJO" result={results.ajo} />
            </Flex>
          </Content>
        </Flex>
      </View>
    </Provider>
  );
}

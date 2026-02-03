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

async function callJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload ?? {})
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function ResultPanel({ title, result }) {
  if (!result) return null;

  const payload = result.json != null ? JSON.stringify(result.json, null, 2) : result.text;

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
          UNSAFE_style={{
            maxHeight: 360,
            overflow: "auto",
            fontFamily: "monospace",
            fontSize: 12
          }}
        >
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{payload}</pre>
        </View>
      </Flex>
    </Well>
  );
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [aemResult, setAemResult] = useState(null);

  // This is your web action path in local dev.
  // You said you're past the <noscript> issue, so this should now hit Runtime.
  const endpoints = useMemo(
    () => ({
      aem: "/api/v1/web/dx-excshell-1/listUnifiedPromos"
    }),
    []
  );

  async function testAem() {
    try {
      setLoading(true);
      const r = await callJson(endpoints.aem);
      setAemResult(r);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Provider theme={defaultTheme} colorScheme="light">
      <View padding="size-300">
        <Flex direction="column" gap="size-200">
          <Heading level={2}>Content Orchestration Studio</Heading>
          <Text>Handshake: UI → Runtime Action → AEM Author GraphQL</Text>

          <Divider />

          <Content>
            <Flex direction="column" gap="size-200">
              <Flex alignItems="center" gap="size-200">
                <ButtonGroup>
                  <Button variant="secondary" onPress={testAem} isDisabled={loading}>
                    Test AEM (list 5 CFs)
                  </Button>
                </ButtonGroup>

                {loading && (
                  <Flex alignItems="center" gap="size-100">
                    <ProgressCircle size="S" aria-label="Running check" isIndeterminate />
                    <Text>Running…</Text>
                  </Flex>
                )}
              </Flex>

              <ResultPanel title="AEM listUnifiedPromos" result={aemResult} />
            </Flex>
          </Content>
        </Flex>
      </View>
    </Provider>
  );
}

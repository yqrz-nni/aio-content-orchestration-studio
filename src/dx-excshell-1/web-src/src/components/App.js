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

// App Builder template usually generates this at build/dev time.
// If your project doesn't have it for some reason, the fallback path will still work.
import config from "./config.json";

async function callJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload ?? {})
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; leave json null
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

  const endpoints = useMemo(() => {
    // Prefer the generated Runtime web-action URL if present
    const fromConfig =
      config?.runtime?.actions?.listUnifiedPromos ||
      config?.runtime?.actionUrls?.listUnifiedPromos;

    // Fallback: your local dev path (works in some setups, but config is safer)
    const fallback = "/api/v1/web/dx-excshell-1/listUnifiedPromos";

    return { aem: fromConfig || fallback };
  }, []);

  async function testAem() {
    setLoading(true);
    try {
      const r = await callJson(endpoints.aem, { limit: 5 });
      setAemResult(r);
    } catch (e) {
      // If fetch itself throws (network/CORS/etc), show it in the panel
      setAemResult({
        ok: false,
        status: 0,
        json: { error: e?.message ?? String(e) },
        text: String(e)
      });
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
                  <Button
                    variant="secondary"
                    onPress={testAem}
                    isDisabled={loading}
                  >
                    Test AEM (list 5 CFs)
                  </Button>
                </ButtonGroup>

                {loading && (
                  <Flex alignItems="center" gap="size-100">
                    <ProgressCircle
                      size="S"
                      aria-label="Running check"
                      isIndeterminate
                    />
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

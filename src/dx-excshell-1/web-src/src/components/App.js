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

import { Runtime } from "@adobe/aio-lib-runtime";

const runtime = new Runtime();

/**
 * Calls an App Builder web action by name.
 * Works in `aio app run` and when deployed.
 *
 * actionName format:
 *   "<package>/<action>"
 * e.g.
 *   "dx-excshell-1/listUnifiedPromos"
 */
async function invokeAction(actionName, body = {}) {
  const action = runtime.action(actionName);
  // action.invoke expects { params, headers, body } depending on usage;
  // passing { body } is the common pattern for JSON payload.
  const result = await action.invoke({ body });
  return result;
}

function ResultPanel({ title, result }) {
  if (!result) return null;

  const payload =
    result.data != null
      ? JSON.stringify(result.data, null, 2)
      : result.error != null
        ? String(result.error)
        : JSON.stringify(result, null, 2);

  return (
    <Well marginTop="size-200">
      <Flex direction="column" gap="size-100">
        <Flex alignItems="center" justifyContent="space-between">
          <Text UNSAFE_style={{ fontWeight: 600 }}>{title}</Text>
          <Text>{result.ok ? "✅" : "❌"}</Text>
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
  const [loadingKey, setLoadingKey] = useState(null);
  const [results, setResults] = useState({
    aem: null
  });

  const actions = useMemo(
    () => ({
      aem: "dx-excshell-1/listUnifiedPromos"
    }),
    []
  );

  async function runCheck(key) {
    try {
      setLoadingKey(key);
      const res = await invokeAction(actions[key], {});
      setResults((prev) => ({
        ...prev,
        [key]: { ok: true, data: res }
      }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [key]: { ok: false, error: e?.message || String(e) }
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
          <Text>Connectivity check: App Builder Runtime → AEM Author GraphQL</Text>

          <Divider />

          <Content>
            <Flex direction="column" gap="size-200">
              <Flex alignItems="center" gap="size-200">
                <ButtonGroup>
                  <Button
                    variant="secondary"
                    onPress={() => runCheck("aem")}
                    isDisabled={anyLoading}
                  >
                    Test AEM (list 5 CFs)
                  </Button>
                </ButtonGroup>

                {anyLoading && (
                  <Flex alignItems="center" gap="size-100">
                    <ProgressCircle size="S" aria-label="Running check" isIndeterminate />
                    <Text>Running: {loadingKey}</Text>
                  </Flex>
                )}
              </Flex>

              <ResultPanel title="AEM listUnifiedPromos" result={results.aem} />
            </Flex>
          </Content>
        </Flex>
      </View>
    </Provider>
  );
}

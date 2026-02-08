import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Heading,
  View,
  Grid,
  Flex,
  Button,
  Text,
  ListView,
  Item,
  Tabs,
  TabList,
  TabPanels,
  Divider,
  TextField,
  Picker,
  StatusLight
} from "@adobe/react-spectrum";

import actions from "../config.json";
import actionWebInvoke from "../utils";
import { ImsContext } from "../context/ImsContext";

function buildHeaders(ims) {
  return {
    Authorization: ims?.token?.startsWith("Bearer ") ? ims.token : `Bearer ${ims?.token}`,
    "x-gw-ims-org-id": ims?.org,
  };
}

// Simple “append module” insertion (v1).
// Later you’ll use deterministic insertion points / structure builders.
function appendModuleToTemplateHtml(html, { vfId, aemCfId, repoId }) {
  const insertion = `
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="640">
      <tbody>
        <tr role="presentation">
          <th class="colspan1">
            <div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false">
              <div class="text-container" data-contenteditable="true">
                <p>{{fragment id='aem:${aemCfId}?repoId=${repoId}' result='cf' r1=r1 r2=r2 r3=r3 r4=r4 r5=r5 r6=r6 r7=r7 r8=r8 r9=r9 r10=r10}}</p>
              </div>
            </div>
            {{ fragment id="ajo:${vfId}" mode="inline" }}
          </th>
        </tr>
      </tbody>
    </table>
  </div>
  `;

  const marker = "</div></body></html>";
  if (html.includes(marker)) return html.replace(marker, `${insertion}${marker}`);
  return html + insertion;
}

export function TemplateStudio() {
  const ims = useContext(ImsContext);
  const headers = useMemo(() => buildHeaders(ims), [ims]);

  // ---- Template session ----
  const [templateId, setTemplateId] = useState(null);
  const [templateName, setTemplateName] = useState("Baseline Clone");
  const [canonicalHtml, setCanonicalHtml] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");

  // ---- Global context (PRB) ----
  const [prbOptions, setPrbOptions] = useState([]); // [{id, label, path}]
  const [selectedPrbId, setSelectedPrbId] = useState(null);

  // ---- Libraries ----
  const [vfItems, setVfItems] = useState([]); // [{id,name}]
  const [contentOptions, setContentOptions] = useState([]); // [{id,label,path}]
  const [selectedVfId, setSelectedVfId] = useState(null);
  const [selectedContentId, setSelectedContentId] = useState(null);

  // ---- Canvas modules (v1: just list of selections) ----
  const [modules, setModules] = useState([]); // [{moduleId, vfId, contentId}]

  // TODO: make repoId dynamic from env/selection
  const repoId = "author-p131724-e1294209.adobeaemcloud.com";

  // ---------------------------
  // Actions
  // ---------------------------

  async function createTemplateFromBaseline() {
    const res = await actionWebInvoke(actions["ajo-template-create"], headers, {
      name: templateName,
      description: "Created from baseline via App Builder",
      createFromBaseline: true,
    });

    const id = res?.templateId;
    setTemplateId(id);

    // Next best: GET canonical HTML from AJO.
    // Add an action ajo-template-get next; for now you can also return html from create action if you prefer.
    // If you already have a get action, call it here and setCanonicalHtml(htmlBody).
    console.log("Create response:", res);
  }

  async function loadVfs() {
    const res = await actionWebInvoke(actions["ajo-vf-demo"], headers);
    setVfItems(res?.fragments || []);
  }

  /**
   * You’ll want TWO CF lists:
   * - PRB Properties list (global)
   * - Unified Promotional Content list (module content)
   *
   * For now, wire these to actions you’ll create/extend:
   * - aem-prb-list
   * - aem-unifiedpromo-list
   */
  async function loadPrbList() {
    const res = await actionWebInvoke(actions["aem-prb-list"]); // you’ll add this action
    const items = res?.data?.prbPropertiesList?.items || [];
    setPrbOptions(
      items.map((it) => ({
        id: it._id,
        label: it.title || it.prbNumber || it._path || it._id,
        path: it._path,
      }))
    );
  }

  async function loadContentList() {
    const res = await actionWebInvoke(actions["aem-unifiedpromo-list"]); // you’ll add this action
    const items = res?.data?.unifiedPromotionalContentList?.items || [];
    setContentOptions(
      items.map((it) => ({
        id: it._id,
        label: it.headlineText || it._path || it._id,
        path: it._path,
      }))
    );
  }

  function setPrb(prbId) {
    setSelectedPrbId(prbId);
    // Later:
    // - update canonical HTML’s PRB fragment call (or ensure baseline already contains it)
    // - trigger re-render (renderer will now have styles/prb vars)
  }

  function addModule() {
    if (!templateId) return;
    if (!selectedVfId || !selectedContentId) return;
    if (!canonicalHtml) {
      // In v1 you’ll load this via ajo-template-get after create
      console.warn("No canonical HTML loaded yet. Add ajo-template-get and load it after creation.");
      return;
    }

    const moduleId = `m_${Date.now()}`;
    const nextModules = [...modules, { moduleId, vfId: selectedVfId, contentId: selectedContentId }];
    setModules(nextModules);

    const nextHtml = appendModuleToTemplateHtml(canonicalHtml, {
      vfId: selectedVfId,
      aemCfId: selectedContentId,
      repoId,
    });

    setCanonicalHtml(nextHtml);
  }

  async function renderPreview() {
    // Phase 0: client-side preview of canonicalHtml
    // Next: call actions["ajo-render-preview"] with { html, prbId, modules } etc.
    setPreviewHtml(
      canonicalHtml || "<html><body><p>No HTML loaded yet (add ajo-template-get).</p></body></html>"
    );
  }

  // Auto-refresh preview when canonical HTML changes
  useEffect(() => {
    if (canonicalHtml) renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalHtml]);

  const prbStatus = selectedPrbId ? "configured" : "missing";

  return (
    <View>
      <Heading level={2}>Template Studio</Heading>

      {/* Global config bar */}
      <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
        <Flex gap="size-200" alignItems="end" wrap>
          <TextField
            label="Template name"
            value={templateName}
            onChange={setTemplateName}
            width="size-3600"
          />
          <Button variant="cta" onPress={createTemplateFromBaseline}>
            Create from baseline
          </Button>

          <Divider orientation="vertical" size="S" />

          <Flex direction="column" gap="size-50">
            <Text>Global configuration</Text>
            <Flex gap="size-200" alignItems="center">
              <Picker
                label="PRB Properties (global)"
                placeholder="Select PRB…"
                selectedKey={selectedPrbId}
                onSelectionChange={(key) => setPrb(key)}
                width="size-3600"
              >
                {prbOptions.map((o) => (
                  <Item key={o.id}>{o.label}</Item>
                ))}
              </Picker>
              <Button variant="secondary" onPress={loadPrbList}>
                Load PRBs
              </Button>

              {prbStatus === "configured" ? (
                <StatusLight variant="positive">PRB set</StatusLight>
              ) : (
                <StatusLight variant="negative">PRB missing</StatusLight>
              )}
            </Flex>
          </Flex>

          <Divider orientation="vertical" size="S" />

          <Flex gap="size-200" alignItems="end">
            <Button variant="secondary" onPress={loadVfs}>
              Load VFs
            </Button>
            <Button variant="secondary" onPress={loadContentList}>
              Load Content CFs
            </Button>
            <Button variant="primary" onPress={renderPreview} isDisabled={!canonicalHtml}>
              Render preview
            </Button>
          </Flex>
        </Flex>

        <View marginTop="size-150">
          <Text>templateId: {templateId || "(not created yet)"}</Text>
        </View>
      </View>

      <Divider size="S" marginY="size-200" />

      {/* Main grid */}
      <Grid columns={["1fr", "2fr", "1fr"]} gap="size-200" height="78vh">
        {/* Left: VFs */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Visual Fragments</Heading>
            <Text>{vfItems.length ? `${vfItems.length}` : ""}</Text>
          </Flex>

          <ListView
            aria-label="VFs"
            selectionMode="single"
            selectedKeys={selectedVfId ? [selectedVfId] : []}
            onSelectionChange={(keys) => setSelectedVfId([...keys][0])}
            height="70vh"
          >
            {vfItems.map((vf) => (
              <Item key={vf.id}>{vf.name}</Item>
            ))}
          </ListView>
        </View>

        {/* Center: Canvas + Preview */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Canvas</Heading>
            <Button
              variant="cta"
              onPress={addModule}
              isDisabled={!templateId || !selectedVfId || !selectedContentId}
            >
              Add module
            </Button>
          </Flex>

          <Text marginTop="size-100" UNSAFE_style={{ opacity: 0.8 }}>
            Tip: PRB is global; Content CF is per-module.
          </Text>

          <Divider size="S" marginY="size-200" />

          <Tabs aria-label="Canvas Tabs">
            <TabList>
              <Item key="preview">Preview</Item>
              <Item key="modules">Modules</Item>
              <Item key="html">AJO HTML</Item>
            </TabList>
            <TabPanels>
              <Item key="preview">
                <View borderWidth="thin" borderColor="light" borderRadius="small" height="62vh">
                  <iframe
                    title="Email Preview"
                    style={{ width: "100%", height: "100%", border: "none" }}
                    sandbox="allow-same-origin"
                    srcDoc={previewHtml}
                  />
                </View>
              </Item>

              <Item key="modules">
                <View height="62vh" overflow="auto">
                  {modules.length === 0 ? (
                    <Text>No modules yet.</Text>
                  ) : (
                    modules.map((m, idx) => (
                      <View key={m.moduleId} marginBottom="size-150">
                        <Text>
                          {idx + 1}. VF: {m.vfId} | CF: {m.contentId}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </Item>

              <Item key="html">
                <View
                  borderWidth="thin"
                  borderColor="light"
                  borderRadius="small"
                  padding="size-200"
                  height="62vh"
                  overflow="auto"
                >
                  <pre style={{ whiteSpace: "pre-wrap" }}>{canonicalHtml || "(empty)"}</pre>
                </View>
              </Item>
            </TabPanels>
          </Tabs>
        </View>

        {/* Right: Content CFs */}
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-200">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading level={4}>Content Fragments</Heading>
            <Text>{contentOptions.length ? `${contentOptions.length}` : ""}</Text>
          </Flex>

          <ListView
            aria-label="Content CFs"
            selectionMode="single"
            selectedKeys={selectedContentId ? [selectedContentId] : []}
            onSelectionChange={(keys) => setSelectedContentId([...keys][0])}
            height="70vh"
          >
            {contentOptions.map((cf) => (
              <Item key={cf.id}>{cf.label}</Item>
            ))}
          </ListView>
        </View>
      </Grid>
    </View>
  );
}
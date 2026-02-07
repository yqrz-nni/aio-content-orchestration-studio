import React, { useContext, useState } from "react";
import { Heading, View, Button, TextField, Text, Divider } from "@adobe/react-spectrum";
import { ImsContext } from "../context/ImsContext";
import actions from "../config.json";
import actionWebInvoke from "../utils";

export function AjoPreviewDemo() {
  const ims = useContext(ImsContext);

  const [templateId, setTemplateId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

  return (
    <View>
      <Heading level={2}>AJO Preview Demo</Heading>

      <TextField
        label="Template ID"
        value={templateId}
        onChange={setTemplateId}
        placeholder="4c73d52f-b683-400d-a907-05a7c02818b0"
      />
      <TextField
        label="Profile ID"
        value={profileId}
        onChange={setProfileId}
        placeholder="BUF19Jmq5K2m4p6L6P1dfoIJmopfl3KJgA"
        marginTop="size-200"
      />

      <Button
        variant="cta"
        marginTop="size-200"
        onPress={async () => {
          setError("");
          setHtml("");
          try {
            const headers = {
              Authorization: `Bearer ${ims?.token}`,
              "x-gw-ims-org-id": ims?.org,
            };

            const res = await actionWebInvoke(
              actions["ajo-preview-template"],
              headers,
              { templateId, profileId }
            );

            setHtml(res?.html || "");
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        Render Preview
      </Button>

      {error ? (
        <Text marginTop="size-200" UNSAFE_style={{ color: "red" }}>
          {error}
        </Text>
      ) : null}

      <Divider marginTop="size-300" />

      {html ? (
        <View marginTop="size-200" height="size-6000">
          <iframe
            title="AJO Preview"
            style={{ width: "100%", height: "100%", border: "1px solid #ccc" }}
            srcDoc={html}
          />
        </View>
      ) : (
        <Text marginTop="size-200">No preview yet.</Text>
      )}
    </View>
  );
}
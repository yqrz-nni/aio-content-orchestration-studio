import React, { useContext } from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";
import { ImsContext } from "../context/ImsContext";
import actions from "../config.json";
import actionWebInvoke from "../utils";

export function AjoPreviewDemo() {
  const ims = useContext(ImsContext);

  return (
    <View>
      <Heading level={2}>Custom Simulation Preview</Heading>

      <Button
        variant="cta"
        onPress={async () => {
          const headers = {
            Authorization: `Bearer ${ims?.token}`,
            "x-gw-ims-org-id": ims?.org,
            "content-type": "application/json",
          };

          const templateHtml = "<div>Hello {{profile.firstName}} {{{vfs.module1}}}</div>";
          const payload = {
            templateHtml,
            context: { profile: { firstName: "Merry Christmas" } },
            vfs: [{ key: "module1", html: "<p>VF injected here</p>" }],
          };

          const res = await actionWebInvoke(actions["ajo-render-preview"], headers, payload);
          console.log("render-preview response:", res);
        }}
      >
        Render preview
      </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}
import React, { useContext } from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";
import actions from "../config.json";
import { ImsContext } from "../context/ImsContext";
import actionWebInvoke from "../utils";

export function AjoCreateTemplate() {
  const ims = useContext(ImsContext);

  return (
    <View>
      <Heading level={2}>AJO Create Template</Heading>

      <Button
        variant="cta"
        onPress={async () => {
          try {
            const headers = {
              Authorization: ims?.token?.startsWith("Bearer ") ? ims.token : `Bearer ${ims?.token}`,
              "x-gw-ims-org-id": ims?.org,
            };

            const res = await actionWebInvoke(
              actions["ajo-template-create"],
              headers,
              {
                name: "Cyber Monday Sale - Header !!",
                description: "Cyber Monday Sale - Header Banner!!",
                templateHtml:
                  "<html> Hi {{profile.person.name}} its a great day to shop !! </html>",
              }
            );

            console.log("AJO template create response:", res);
          } catch (e) {
            console.error("AJO template create failed:", e);
          }
        }}
      >
        Run query
      </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}
import React from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";
import actions from "../config.json";
import actionWebInvoke from "../utils";

export function AjoCreateTemplate() {
  return (
    <View>
      <Heading level={2}>AJO Create Template</Heading>

      <Button
        variant="cta"
        onPress={async () => {
            const res = await actionWebInvoke(actions["ajo-template-create"], {}, {
                name: "Cyber Monday Sale - Header !!",
                description: "Cyber Monday Sale - Header Banner!!",
                templateHtml: "<html> Hi {{profile.person.name}} its a great day to shop !! </html>",
            });
            console.log("GraphQL action response:", res);
        }}
      >
      Run query
    </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}

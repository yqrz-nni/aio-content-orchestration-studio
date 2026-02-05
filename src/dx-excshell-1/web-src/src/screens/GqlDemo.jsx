import React from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";
import actions from "../config.json";
import actionWebInvoke from "../utils";

export function GqlDemo() {
  return (
    <View>
      <Heading level={2}>AEM GraphQL Demo</Heading>

      <Button
        variant="cta"
        onPress={async () => {
            const res = await actionWebInvoke(actions["aem-gql-demo"]);
            console.log("GraphQL action response:", res);
        }}
      >
      Run query
    </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}

import React from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";

export function GqlDemo() {
  return (
    <View>
      <Heading level={2}>AEM GraphQL Demo</Heading>

      <Button
        variant="cta"
        onPress={async () => {
            const res = await fetch("/api/v1/web/dx-excshell-1/aem-gql-demo.json", {
                method: "GET",
            });

            const text = await res.text();
            console.log("action status:", res.status);
            console.log("action response:", text);
        }}
      >
      Run query
    </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}

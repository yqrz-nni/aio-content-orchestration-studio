import React from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";

export function GqlDemo() {
  return (
    <View>
      <Heading level={2}>AEM GraphQL Demo</Heading>

      <Button variant="cta" onPress={() => console.log("Clicked: Run query")}>
        Run query
      </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}

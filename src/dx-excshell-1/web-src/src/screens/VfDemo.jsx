import React from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";
import actions from "../config.json";
import actionWebInvoke from "../utils";

export function VfDemo() {
  return (
    <View>
      <Heading level={2}>AJO VF Demo</Heading>

      <Button
        variant="cta"
        onPress={async () => {
            const res = await actionWebInvoke(actions["ajo-vf-demo"]);
            console.log("AJO action response:", res);
        }}
      >
      Run query
    </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}

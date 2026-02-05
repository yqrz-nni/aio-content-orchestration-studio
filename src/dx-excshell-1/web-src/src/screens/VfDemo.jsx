import React from "react";
import { Heading, View, Button, Text } from "@adobe/react-spectrum";
import { ImsContext } from "../context/ImsContext";
import actions from "../config.json";
import actionWebInvoke from "../utils";

export function VfDemo() {
  const ims = useContext(ImsContext);
  const [fragments, setFragments] = useState([]);
  const [error, setError] = useState("");

  return (
    <View>
      <Heading level={2}>AJO VF Demo</Heading>

      <Button
        variant="cta"
        onPress={async () => {
            setError("");
            try {
              const headers = {
                Authorization: `Bearer ${ims?.token}`,
                "x-gw-ims-org-id": ims?.org,
              };
              const res = await actionWebInvoke(actions["ajo-vf-demo"]);
              console.log("AJO action response:", res);
            } catch (e) {
                setError(e.message);
            }
        }}
      >
      Get 5 random VF items
    </Button>

      <Text marginTop="size-200">Open the console and click the button.</Text>
    </View>
  );
}

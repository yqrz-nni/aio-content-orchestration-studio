import React from 'react'
import { View, Text, Divider } from '@adobe/react-spectrum'

// Pure visual scaffold, no D3 for now (extensible later)
export default function AudienceGraph ({ audiences, transitions }) {
  return (
    <View borderWidth='thin' borderColor='gray-400' borderRadius='medium' padding='size-150' height='400px'>
      <Text><strong>Graph representation</strong></Text>
      <Divider marginY='size-100' />
      <View>
        {audiences.map((node) => (
          <Text key={node.id} marginY='size-50'>• {node.id}: {node.name}</Text>
        ))}
      </View>
      <Divider marginY='size-100' />
      <View>
        {transitions.map((edge) => (
          <Text key={`${edge.from}-${edge.to}-${edge.label}`} marginY='size-50'>→ {edge.from} → {edge.to} [{edge.type}] {edge.label}</Text>
        ))}
      </View>
    </View>
  )
}

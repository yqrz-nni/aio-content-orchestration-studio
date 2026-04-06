import React, { useMemo, useState } from 'react'
import { View, Heading, Flex, Divider, Button, Text } from '@adobe/react-spectrum'
import AudienceGraph from './AudienceGraph'
import AudienceRuleEditor from './AudienceRuleEditor'

const initialAudiences = [
  {
    id: 'A',
    name: 'Newly Lapsed Web Visitors',
    description: 'Users who stopped visiting website in last 7 days',
  },
  {
    id: 'B',
    name: 'Newly Active Web Visitors',
    description: 'Users who resumed visit after a period of inactivity',
  },
  {
    id: 'C',
    name: 'Extended Lapsed Web Visitors',
    description: 'Users still inactive after 30 days',
  },
]

const initialTransitions = [
  { from: 'A', to: 'B', type: 'positive', label: 'Re-engaged within 7d' },
  { from: 'A', to: 'C', type: 'negative', label: 'No re-engagement by 30d' },
]

export default function AudienceStateStudio () {
  const [audiences, setAudiences] = useState(initialAudiences)
  const [transitions, setTransitions] = useState(initialTransitions)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const useCases = useMemo(() => ({
    audienceCount: audiences.length,
    transitionCount: transitions.length,
  }), [audiences.length, transitions.length])

  function onSaveRule (newTransition) {
    setTransitions((prev) => [...prev, newTransition])
    setIsEditorOpen(false)
  }

  return (
    <View padding='size-200'>
      <Flex direction='column' gap='size-100'>
        <Heading level={2}>Audience State Orchestration Studio</Heading>
        <Text>Visual state canvas and rule definition for journey paths.</Text>
        <Divider />
        <Flex direction='row' gap='size-100'>
          <View width='70%'>
            <AudienceGraph audiences={audiences} transitions={transitions} />
            <Button variant='cta' onPress={() => setIsEditorOpen(true)}>Add Transition</Button>
          </View>
          <View width='30%'>
            <Heading level={4}>Summary</Heading>
            <Text>Audiences: {useCases.audienceCount}</Text>
            <Text>Transitions: {useCases.transitionCount}</Text>
            <Divider marginY='size-100' />
            <Heading level={4}>Rules</Heading>
            {transitions.map((t) => (
              <Text key={`${t.from}-${t.to}-${t.label}`}>{t.from} → {t.to} ({t.type}) {t.label}</Text>
            ))}
          </View>
        </Flex>
      </Flex>
      {isEditorOpen && <AudienceRuleEditor onSave={onSaveRule} onCancel={() => setIsEditorOpen(false)} audiences={audiences} />}
    </View>
  )
}

import React, { useState } from 'react'
import { View, Dialog, Heading, TextField, Picker, Item, RadioGroup, Radio, Button, Flex } from '@adobe/react-spectrum'

export default function AudienceRuleEditor ({ audiences, onSave, onCancel }) {
  const [from, setFrom] = useState(audiences[0]?.id || '')
  const [to, setTo] = useState(audiences[1]?.id || '')
  const [type, setType] = useState('positive')
  const [label, setLabel] = useState('')

  return (
    <Dialog isOpen aria-label='Audience transition editor'>
      <Heading>Define State Transition</Heading>
      <View marginTop='size-150'>
        <Picker label='From audience' selectedKey={from} onSelectionChange={setFrom}>
          {audiences.map((a) => <Item key={a.id}>{a.name}</Item>)}
        </Picker>
        <Picker label='To audience' selectedKey={to} onSelectionChange={setTo} marginTop='size-100'>
          {audiences.map((a) => <Item key={a.id}>{a.name}</Item>)}
        </Picker>
        <RadioGroup label='Transition type' value={type} onChange={setType} marginTop='size-100'>
          <Radio value='positive'>Positive</Radio>
          <Radio value='negative'>Negative</Radio>
          <Radio value='neutral'>Neutral</Radio>
        </RadioGroup>
        <TextField label='Label' value={label} onChange={setLabel} marginTop='size-100' />
      </View>
      <Flex marginTop='size-150' gap='size-100' justifyContent='end'>
        <Button variant='secondary' onPress={onCancel}>Cancel</Button>
        <Button isDisabled={!from || !to || !label} variant='cta' onPress={() => onSave({ from, to, type, label })}>Save</Button>
      </Flex>
    </Dialog>
  )
}

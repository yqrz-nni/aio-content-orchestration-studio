import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heading, View, Flex, Button, Text, Divider, TextField } from '@adobe/react-spectrum'

export function ProfileLabCreate () {
  const nav = useNavigate()
  const [profileName, setProfileName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [channel, setChannel] = useState('Email')

  const canSave = profileName.trim() && profileId.trim()

  return (
    <View>
      <Heading level={2}>Create Test Profile</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Starter create form. Hook this up to your backend action when ready.
      </Text>
      <Divider size="S" marginY="size-200" />

      <Flex direction="column" gap="size-150" maxWidth="size-4600">
        <TextField label="Profile Name" value={profileName} onChange={setProfileName} />
        <TextField label="Profile ID" value={profileId} onChange={setProfileId} />
        <TextField label="Default Channel" value={channel} onChange={setChannel} />

        <Flex gap="size-100">
          <Button variant="cta" isDisabled={!canSave} onPress={() => nav('/profile-lab')}>
            Save Profile
          </Button>
          <Button variant="secondary" onPress={() => nav('/profile-lab')}>
            Cancel
          </Button>
        </Flex>
      </Flex>
    </View>
  )
}

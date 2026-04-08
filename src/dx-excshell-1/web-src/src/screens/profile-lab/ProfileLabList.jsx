import React, { useContext, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heading, View, Flex, Button, Text, Divider, StatusLight, TextField } from '@adobe/react-spectrum'

import actions from '../../config.json'
import actionWebInvoke from '../../utils'
import { ImsContext } from '../../context/ImsContext'

function buildHeaders (ims) {
  return {
    Authorization: ims?.token?.startsWith('Bearer ') ? ims.token : `Bearer ${ims?.token}`,
    'x-gw-ims-org-id': ims?.org
  }
}

function toUiProfile (row) {
  return {
    id: row?.email || row?.novoMedlinkId || row?.testProfileId || row?.profileId || 'unknown-profile',
    name: row?.name || '(unnamed profile)',
    channel: row?.channel || '-',
    email: row?.email || '-',
    status: row?.status || '-',
    tags: Array.isArray(row?.tags) ? row.tags : []
  }
}

export function ProfileLabList () {
  const nav = useNavigate()
  const ims = useContext(ImsContext)
  const headers = useMemo(() => buildHeaders(ims), [ims])

  const [identityType, setIdentityType] = useState('email')
  const [singleValue, setSingleValue] = useState('')

  const [profiles, setProfiles] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Look up one profile by identity.')
  const [err, setErr] = useState('')

  async function lookupSingle () {
    const value = String(singleValue || '').trim()
    if (!value) return

    try {
      setIsLoading(true)
      setErr('')
      setStatusMsg('Searching...')

      let payload
      if (identityType === 'email') {
        payload = { emails: [value.toLowerCase()] }
      } else {
        payload = { entityId: value, entityIdNS: '__tenant__' }
      }

      const res = await actionWebInvoke(actions['profile-lab-direct-read'], headers, payload, { method: 'POST' })
      const rows = Array.isArray(res?.items) ? res.items : []
      setProfiles(rows.map(toUiProfile))
      setStatusMsg(`Found ${rows.length} profile(s).`)
    } catch (e) {
      setProfiles([])
      setErr(e?.message || 'Lookup failed')
      setStatusMsg('')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <View>
      <Heading level={2}>Profile Lab</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Lookup-first mode. Find specific Test Profiles by identity instead of loading full dataset lists.
      </Text>
      <Divider size='S' marginY='size-200' />

      <Flex direction='column' gap='size-150'>
        <View borderWidth='thin' borderColor='dark' borderRadius='small' padding='size-150'>
          <Heading level={4}>Single Lookup</Heading>
          <Text UNSAFE_style={{ opacity: 0.8, marginBottom: 8 }}>
            Select identity type, then search one profile.
          </Text>

          <Flex gap='size-100' wrap>
            <Button variant={identityType === 'email' ? 'primary' : 'secondary'} onPress={() => setIdentityType('email')}>Email</Button>
            <Button variant={identityType === 'tenant' ? 'primary' : 'secondary'} onPress={() => setIdentityType('tenant')}>Tenant NS (novoMedlinkId)</Button>
          </Flex>

          <TextField
            label='Identity value'
            value={singleValue}
            onChange={setSingleValue}
            width='100%'
            marginTop='size-150'
          />

          <Flex gap='size-100' marginTop='size-150' wrap>
            <Button variant='cta' onPress={lookupSingle} isDisabled={isLoading || !singleValue.trim()}>
              Search Profile
            </Button>
            <Button variant='secondary' onPress={() => nav('/profile-lab/new')}>
              Create Profile
            </Button>
          </Flex>
        </View>

        {statusMsg ? <StatusLight variant='info'>{statusMsg}</StatusLight> : null}
        {err ? <StatusLight variant='negative'>{err}</StatusLight> : null}

        {profiles.map((profile) => (
          <View key={profile.id} borderWidth='thin' borderColor='dark' borderRadius='small' padding='size-150'>
            <Flex justifyContent='space-between' alignItems='center' wrap gap='size-100'>
              <View>
                <Text>{profile.name}</Text>
                <Text UNSAFE_style={{ opacity: 0.75, fontSize: 12 }}>
                  ID: {profile.id} | Email: {profile.email} | Channel: {profile.channel} | Status: {profile.status}
                </Text>
                {profile.tags.length ? (
                  <Text UNSAFE_style={{ opacity: 0.7, fontSize: 12 }}>
                    Tags: {profile.tags.join(', ')}
                  </Text>
                ) : null}
              </View>
              <Button variant='secondary' onPress={() => nav(`/profile-lab/${encodeURIComponent(profile.id)}/edit`)}>
                Edit
              </Button>
            </Flex>
          </View>
        ))}
      </Flex>
    </View>
  )
}

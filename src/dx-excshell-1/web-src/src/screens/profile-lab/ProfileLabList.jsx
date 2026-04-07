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

function parseLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function toUiProfile (row) {
  return {
    id: row?.profileId || row?.testProfileId || row?.novoMedlinkId || 'unknown-profile',
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
  const [bulkText, setBulkText] = useState('')

  const [queryIdInput, setQueryIdInput] = useState('')
  const [queryDebugResult, setQueryDebugResult] = useState('')

  const [profiles, setProfiles] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Look up one profile or bulk lookup many identities.')
  const [err, setErr] = useState('')

  async function lookupSingle () {
    const value = String(singleValue || '').trim()
    if (!value) return

    try {
      setIsLoading(true)
      setErr('')
      setStatusMsg('Searching...')
      setQueryDebugResult('')

      let payload
      if (identityType === 'email') {
        payload = { emails: [value.toLowerCase()] }
      } else if (identityType === 'tenant') {
        payload = { entityId: value, entityIdNS: '__tenant__' }
      } else {
        payload = { entityId: value, entityIdNS: 'testProfileId' }
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

  async function lookupBulkEmails () {
    const emails = parseLines(bulkText).map((x) => x.toLowerCase())
    if (!emails.length) return

    try {
      setIsLoading(true)
      setErr('')
      setStatusMsg(`Looking up ${emails.length} identities...`)
      setQueryDebugResult('')

      const res = await actionWebInvoke(actions['profile-lab-direct-read'], headers, { emails }, { method: 'POST' })
      const rows = Array.isArray(res?.items) ? res.items : []
      setProfiles(rows.map(toUiProfile))
      setStatusMsg(`Found ${rows.length} profile(s) from ${emails.length} input row(s).`)
    } catch (e) {
      setProfiles([])
      setErr(e?.message || 'Bulk lookup failed')
      setStatusMsg('')
    } finally {
      setIsLoading(false)
    }
  }

  async function debugQueryResult () {
    const qid = String(queryIdInput || '').trim()
    if (!qid) return

    try {
      setIsLoading(true)
      setErr('')
      setStatusMsg(`Fetching query result for ${qid}...`)

      const res = await actionWebInvoke(actions['profile-lab-list'], headers, { op: 'result', queryId: qid }, { method: 'POST' })
      setQueryDebugResult(JSON.stringify(res, null, 2))

      const rows = Array.isArray(res?.items) ? res.items : []
      if (rows.length) {
        setProfiles(rows.map(toUiProfile))
        setStatusMsg(`Query returned ${rows.length} row(s).`)
      } else {
        setStatusMsg(`Query state: ${String(res?.state || 'UNKNOWN')}. No row payload returned.`)
      }
    } catch (e) {
      setQueryDebugResult('')
      setErr(e?.message || 'Query result check failed')
      setStatusMsg('')
    } finally {
      setIsLoading(false)
    }
  }

  async function debugQueryStatus () {
    const qid = String(queryIdInput || '').trim()
    if (!qid) return

    try {
      setIsLoading(true)
      setErr('')
      setStatusMsg(`Checking query status for ${qid}...`)

      const res = await actionWebInvoke(actions['profile-lab-list'], headers, { op: 'status', queryId: qid }, { method: 'POST' })
      setQueryDebugResult(JSON.stringify(res, null, 2))
      setStatusMsg(`Query status: ${String(res?.state || 'UNKNOWN')}`)
    } catch (e) {
      setQueryDebugResult('')
      setErr(e?.message || 'Query status check failed')
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
      <Divider size="S" marginY="size-200" />

      <Flex direction="column" gap="size-150">
        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-150">
          <Heading level={4}>Single Lookup</Heading>
          <Text UNSAFE_style={{ opacity: 0.8, marginBottom: 8 }}>
            Select identity type, then search one profile.
          </Text>

          <Flex gap="size-100" wrap>
            <Button variant={identityType === 'email' ? 'primary' : 'secondary'} onPress={() => setIdentityType('email')}>Email</Button>
            <Button variant={identityType === 'tenant' ? 'primary' : 'secondary'} onPress={() => setIdentityType('tenant')}>Tenant NS (novoMedlinkId)</Button>
            <Button variant={identityType === 'testProfileId' ? 'primary' : 'secondary'} onPress={() => setIdentityType('testProfileId')}>testProfileId</Button>
          </Flex>

          <TextField
            label="Identity value"
            value={singleValue}
            onChange={setSingleValue}
            width="100%"
            marginTop="size-150"
          />

          <Flex gap="size-100" marginTop="size-150" wrap>
            <Button variant="cta" onPress={lookupSingle} isDisabled={isLoading || !singleValue.trim()}>
              Search Profile
            </Button>
            <Button variant="secondary" onPress={() => nav('/profile-lab/new')}>
              Create Profile
            </Button>
          </Flex>
        </View>

        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-150">
          <Heading level={4}>Bulk Email Lookup</Heading>
          <Text UNSAFE_style={{ opacity: 0.8, marginBottom: 8 }}>
            Paste one email per line to lookup multiple profiles.
          </Text>

          <TextField
            label="Emails (one per line)"
            value={bulkText}
            onChange={setBulkText}
            width="100%"
            height="size-2400"
          />

          <Flex gap="size-100" marginTop="size-150" wrap>
            <Button variant="secondary" onPress={lookupBulkEmails} isDisabled={isLoading || !bulkText.trim()}>
              Bulk Search
            </Button>
          </Flex>
        </View>

        <View borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-150">
          <Heading level={4}>Query ID Debug</Heading>
          <Text UNSAFE_style={{ opacity: 0.8, marginBottom: 8 }}>
            Verify Query Service wiring by checking status/result for a specific query ID.
          </Text>

          <TextField
            label="Query ID"
            value={queryIdInput}
            onChange={setQueryIdInput}
            width="100%"
          />

          <Flex gap="size-100" marginTop="size-150" wrap>
            <Button variant="secondary" onPress={debugQueryStatus} isDisabled={isLoading || !queryIdInput.trim()}>
              Check Status
            </Button>
            <Button variant="secondary" onPress={debugQueryResult} isDisabled={isLoading || !queryIdInput.trim()}>
              Fetch Result
            </Button>
          </Flex>

          {queryDebugResult ? (
            <View marginTop="size-150" borderWidth="thin" borderColor="light" borderRadius="small" padding="size-100" height="size-3000" overflow="auto">
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{queryDebugResult}</pre>
            </View>
          ) : null}
        </View>

        {statusMsg ? <StatusLight variant="info">{statusMsg}</StatusLight> : null}
        {err ? <StatusLight variant="negative">{err}</StatusLight> : null}

        {profiles.map((profile) => (
          <View key={profile.id} borderWidth="thin" borderColor="dark" borderRadius="small" padding="size-150">
            <Flex justifyContent="space-between" alignItems="center" wrap gap="size-100">
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
              <Button variant="secondary" onPress={() => nav(`/profile-lab/${encodeURIComponent(profile.id)}/edit`)}>
                Edit
              </Button>
            </Flex>
          </View>
        ))}
      </Flex>
    </View>
  )
}



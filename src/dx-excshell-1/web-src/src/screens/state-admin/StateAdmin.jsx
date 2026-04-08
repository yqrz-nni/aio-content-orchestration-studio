import React, { useContext, useEffect, useMemo, useState } from 'react'
import {
  Heading,
  View,
  Flex,
  Button,
  Text,
  Divider,
  StatusLight,
  TextField,
  TextArea
} from '@adobe/react-spectrum'

import actions from '../../config.json'
import actionWebInvoke from '../../utils'
import { ImsContext } from '../../context/ImsContext'

function buildHeaders (ims) {
  return {
    Authorization: ims?.token?.startsWith('Bearer ') ? ims.token : `Bearer ${ims?.token}`,
    'x-gw-ims-org-id': ims?.org
  }
}

export function StateAdmin () {
  const ims = useContext(ImsContext)
  const headers = useMemo(() => buildHeaders(ims), [ims])

  const [items, setItems] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [newKey, setNewKey] = useState('')
  const [valueText, setValueText] = useState('{\n  "hello": "world"\n}')

  const [loadingList, setLoadingList] = useState(false)
  const [loadingItem, setLoadingItem] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')

  const activeKey = selectedKey || newKey

  async function refreshList () {
    try {
      setLoadingList(true)
      setErr('')
      const res = await actionWebInvoke(actions['state-admin-list'], headers, {}, { method: 'POST' })
      setItems(Array.isArray(res?.items) ? res.items : [])
      setStatus(`Loaded ${Array.isArray(res?.items) ? res.items.length : 0} dataset key(s).`)
    } catch (e) {
      setErr(e?.message || 'Failed to load dataset keys')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadKey (key) {
    const nextKey = String(key || '').trim()
    if (!nextKey) return

    try {
      setLoadingItem(true)
      setErr('')
      const res = await actionWebInvoke(actions['state-admin-get'], headers, { key: nextKey }, { method: 'POST' })
      setSelectedKey(nextKey)
      setNewKey('')
      const serialized = res?.isJson ? JSON.stringify(res.value ?? {}, null, 2) : String(res?.value || '')
      setValueText(serialized)
      setStatus(`Loaded key: ${nextKey}`)
    } catch (e) {
      setErr(e?.message || 'Failed to load key')
    } finally {
      setLoadingItem(false)
    }
  }

  async function saveActive () {
    const key = String(activeKey || '').trim()
    if (!key) return

    let parsed
    try {
      parsed = JSON.parse(valueText)
    } catch (e) {
      setErr('Value must be valid JSON before saving.')
      return
    }

    try {
      setSaving(true)
      setErr('')
      await actionWebInvoke(actions['state-admin-upsert'], headers, { key, value: parsed }, { method: 'POST' })
      setSelectedKey(key)
      setNewKey('')
      setStatus(`Saved key: ${key}`)
      await refreshList()
    } catch (e) {
      setErr(e?.message || 'Failed to save key')
    } finally {
      setSaving(false)
    }
  }

  async function deleteActive () {
    const key = String(activeKey || '').trim()
    if (!key) return

    try {
      setDeleting(true)
      setErr('')
      await actionWebInvoke(actions['state-admin-delete'], headers, { key }, { method: 'POST' })
      setSelectedKey('')
      setNewKey('')
      setValueText('{\n  "hello": "world"\n}')
      setStatus(`Deleted key: ${key}`)
      await refreshList()
    } catch (e) {
      setErr(e?.message || 'Failed to delete key')
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    refreshList()
  }, [])

  return (
    <View>
      <Heading level={2}>State Admin</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Manage app-level managed-state datasets as JSON for any app use case.
      </Text>
      <Divider size='S' marginY='size-200' />

      <Flex direction='column' gap='size-150'>
        <Flex gap='size-100' wrap>
          <Button variant='primary' onPress={refreshList} isDisabled={loadingList}>{loadingList ? 'Refreshing...' : 'Refresh Keys'}</Button>
        </Flex>

        {status ? <StatusLight variant='positive'>{status}</StatusLight> : null}
        {err ? <StatusLight variant='negative'>{err}</StatusLight> : null}

        <View borderWidth='thin' borderColor='dark' borderRadius='small' padding='size-150'>
          <Heading level={4}>Dataset Keys</Heading>
          <Flex direction='column' gap='size-75'>
            {items.length ? items.map((item) => (
              <Flex key={item.key} justifyContent='space-between' alignItems='center'>
                <Text>{item.key}</Text>
                <Button variant='secondary' onPress={() => loadKey(item.key)} isDisabled={loadingItem}>Load</Button>
              </Flex>
            )) : <Text>No keys yet.</Text>}
          </Flex>
        </View>

        <View borderWidth='thin' borderColor='dark' borderRadius='small' padding='size-150'>
          <Heading level={4}>Editor</Heading>
          <TextField
            label='Selected key (existing)'
            value={selectedKey}
            onChange={setSelectedKey}
            width='100%'
          />
          <TextField
            label='Or new key'
            value={newKey}
            onChange={setNewKey}
            width='100%'
            marginTop='size-150'
          />
          <TextArea
            label='JSON value'
            value={valueText}
            onChange={setValueText}
            width='100%'
            height='size-3400'
            marginTop='size-150'
          />

          <Flex gap='size-100' marginTop='size-150' wrap>
            <Button variant='cta' onPress={saveActive} isDisabled={saving || !activeKey.trim()}>{saving ? 'Saving...' : 'Save'}</Button>
            <Button variant='negative' onPress={deleteActive} isDisabled={deleting || !activeKey.trim()}>{deleting ? 'Deleting...' : 'Delete'}</Button>
          </Flex>
        </View>
      </Flex>
    </View>
  )
}

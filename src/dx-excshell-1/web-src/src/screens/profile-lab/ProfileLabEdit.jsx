import React, { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Heading,
  View,
  Flex,
  Button,
  Text,
  Divider,
  TextField,
  TextArea,
  StatusLight,
  NumberField,
  Checkbox,
  ProgressCircle,
  Picker,
  Item
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

function getByPath (obj, path) {
  const parts = String(path || '').split('.').filter(Boolean)
  let cur = obj
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function setByPath (obj, path, value) {
  const parts = String(path || '').split('.').filter(Boolean)
  if (!parts.length) return

  let cur = obj
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) cur[part] = {}
    cur = cur[part]
  }

  cur[parts[parts.length - 1]] = value
}

function isNumericType (type) {
  return ['integer', 'int', 'long', 'number', 'double', 'float'].includes(String(type || '').toLowerCase())
}

function isDateType (field) {
  return field?.format === 'date' || field?.format === 'date-time'
}

function normalizeFieldValue (field, value) {
  const type = String(field?.type || '').toLowerCase()

  if (value === undefined || value === null) {
    if (type === 'boolean') return false
    return ''
  }

  if (isDateType(field)) return String(value)

  if (isNumericType(type)) {
    if (typeof value === 'number') return value
    const n = Number(value)
    return Number.isFinite(n) ? n : ''
  }

  if (type === 'array') {
    const itemType = String(field?.itemType || '').toLowerCase()
    if (!Array.isArray(value)) return ''

    if (!itemType || itemType === 'string') return value.join('\n')
    return JSON.stringify(value, null, 2)
  }

  if (type === 'boolean') return Boolean(value)

  if (type === 'object') return JSON.stringify(value, null, 2)

  return String(value)
}

function valueForSave (field, value) {
  const type = String(field?.type || '').toLowerCase()

  if (isDateType(field)) {
    const v = String(value || '').trim()
    if (!v) return ''
    if (field.format === 'date-time') return `${v}T00:00:00Z`
    return v
  }

  if (type === 'array') {
    const itemType = String(field?.itemType || '').toLowerCase()
    if (!itemType || itemType === 'string') {
      return String(value || '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
    }

    const text = String(value || '').trim()
    if (!text) return []
    return JSON.parse(text)
  }

  if (type === 'object') {
    const text = String(value || '').trim()
    if (!text) return {}
    return JSON.parse(text)
  }

  if (['integer', 'int', 'long'].includes(type)) {
    if (value === '' || value === null || value === undefined) return null
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }

  if (['number', 'double', 'float'].includes(type)) {
    if (value === '' || value === null || value === undefined) return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  if (type === 'boolean') return Boolean(value)

  return String(value || '')
}

function valuesEqual (a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function guessIdentityNs (decodedProfileId, currentNovo) {
  const id = String(decodedProfileId || '').trim()
  if (id.includes('@')) return 'Email'
  if (currentNovo?.testProfileId) return 'testProfileId'
  if (currentNovo?.novoMedlinkId) return '__tenant__'
  return 'testProfileId'
}

function guessIdentityValue (decodedProfileId, currentNovo, ns) {
  if (ns === 'Email') return currentNovo?.email || decodedProfileId || ''
  if (ns === '__tenant__') return currentNovo?.novoMedlinkId || decodedProfileId || ''
  return currentNovo?.testProfileId || decodedProfileId || ''
}

function toLookupPayload (decodedProfileId) {
  const id = String(decodedProfileId || '').trim()
  if (!id) return null
  if (id.includes('@')) return { emails: [id.toLowerCase()] }
  return { entityId: id, entityIdNS: 'testProfileId' }
}

function fieldLabel (field) {
  return field?.title || field?.path || 'field'
}

function fieldHelpText (field) {
  const chunks = []
  if (field?.enum?.length) chunks.push(`Allowed: ${field.enum.join(', ')}`)
  if (field?.format) chunks.push(`Format: ${field.format}`)
  if (field?.type === 'array') {
    const itemType = field?.itemType || 'string'
    chunks.push(`Array of ${itemType}`)
    if (field?.itemEnum?.length) chunks.push(`Item values: ${field.itemEnum.join(', ')}`)
  }
  return chunks.join(' | ')
}

function getSectionKey (path) {
  const parts = String(path || '').split('.').filter(Boolean)
  if (parts.length <= 1) return '__root__'
  return parts.slice(0, parts.length - 1).join('.')
}

function sectionTitle (sectionKey) {
  if (sectionKey === '__root__') return 'Profile Core Fields'
  return sectionKey
}

function groupFields (fields) {
  const map = new Map()
  for (const field of fields) {
    const key = getSectionKey(field.path)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(field)
  }

  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      title: sectionTitle(key),
      fields: items.sort((a, b) => String(a.path).localeCompare(String(b.path)))
    }))
    .sort((a, b) => {
      if (a.key === '__root__') return -1
      if (b.key === '__root__') return 1
      return a.title.localeCompare(b.title)
    })
}

export function ProfileLabEdit () {
  const nav = useNavigate()
  const { profileId } = useParams()
  const ims = useContext(ImsContext)
  const headers = useMemo(() => buildHeaders(ims), [ims])

  const decodedProfileId = useMemo(() => decodeURIComponent(profileId || ''), [profileId])

  const [schemaId, setSchemaId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [fields, setFields] = useState([])

  const [identityNs, setIdentityNs] = useState('testProfileId')
  const [identityValue, setIdentityValue] = useState(decodedProfileId)

  const [baselineValues, setBaselineValues] = useState({})
  const [formValues, setFormValues] = useState({})

  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('Load schema and current profile attributes to begin editing.')
  const [err, setErr] = useState('')

  const sections = useMemo(() => groupFields(fields), [fields])

  function onFieldChange (path, value) {
    setFormValues((prev) => ({ ...prev, [path]: value }))
  }

  function onFieldUndo (e, path) {
    const isUndo = (e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'z'
    if (!isUndo) return
    e.preventDefault()
    onFieldChange(path, baselineValues[path])
  }

  async function loadSchema () {
    try {
      setIsLoading(true)
      setErr('')
      setStatus('Loading schema fields...')

      const payload = {}
      if (schemaId.trim()) payload.schemaId = schemaId.trim()
      if (datasetId.trim()) payload.datasetId = datasetId.trim()

      const res = await actionWebInvoke(actions['profile-lab-schema-fields'], headers, payload, { method: 'POST' })
      const nextFields = Array.isArray(res?.fields) ? res.fields : []

      setFields(nextFields)
      if (!schemaId && res?.schemaId) setSchemaId(res.schemaId)
      if (!datasetId && res?.datasetId) setDatasetId(res.datasetId)

      setStatus(`Loaded ${nextFields.length} field(s) from schema.`)
      return nextFields
    } catch (e) {
      setErr(e?.message || 'Failed to load schema fields')
      setStatus('')
      return []
    } finally {
      setIsLoading(false)
    }
  }

  async function loadCurrentValues (knownFields = fields) {
    const payload = toLookupPayload(decodedProfileId)
    if (!payload) {
      setErr('Missing profile identifier in route.')
      setStatus('')
      return
    }

    try {
      setIsLoading(true)
      setErr('')
      setStatus('Loading current profile attributes...')

      let res = await actionWebInvoke(actions['profile-lab-direct-read'], headers, payload, { method: 'POST' })
      let first = Array.isArray(res?.items) && res.items.length ? res.items[0] : null

      if (!first && !decodedProfileId.includes('@')) {
        res = await actionWebInvoke(actions['profile-lab-direct-read'], headers, {
          entityId: decodedProfileId,
          entityIdNS: '__tenant__'
        }, { method: 'POST' })
        first = Array.isArray(res?.items) && res.items.length ? res.items[0] : null
      }

      const currentNovo = first?.rawNovo || {}

      const effectiveNs = guessIdentityNs(decodedProfileId, currentNovo)
      const effectiveValue = guessIdentityValue(decodedProfileId, currentNovo, effectiveNs)
      setIdentityNs(effectiveNs)
      setIdentityValue(effectiveValue)

      const nextBaseline = {}
      const sourceFields = Array.isArray(knownFields) ? knownFields : []
      for (const field of sourceFields) {
        const raw = getByPath(currentNovo, field.path)
        nextBaseline[field.path] = normalizeFieldValue(field, raw)
      }

      setBaselineValues(nextBaseline)
      setFormValues(nextBaseline)
      setStatus(`Loaded current values for ${Object.keys(nextBaseline).length} field(s). Ctrl+Z in any field restores its loaded value.`)
    } catch (e) {
      setErr(e?.message || 'Failed to load current profile attributes')
      setStatus('')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadAll () {
    const loadedFields = await loadSchema()
    if (loadedFields.length) await loadCurrentValues(loadedFields)
  }

  async function saveChanges () {
    try {
      setIsSaving(true)
      setErr('')
      setStatus('Submitting update...')

      const novoPatch = {}
      for (const field of fields) {
        const path = field.path
        const before = baselineValues[path]
        const current = formValues[path]
        if (valuesEqual(before, current)) continue

        let converted
        try {
          converted = valueForSave(field, current)
        } catch (parseErr) {
          setErr(`Invalid value for ${path}: ${parseErr.message}`)
          setStatus('')
          return
        }

        if (converted === null) continue
        setByPath(novoPatch, path, converted)
      }

      if (!Object.keys(novoPatch).length) {
        setStatus('No changes detected.')
        return
      }

      const payload = {
        identityNs: identityNs.trim(),
        identityValue: identityValue.trim(),
        attributes: { _novo: novoPatch },
        syncValidation: true
      }

      if (schemaId.trim()) payload.AEP_XDM_SCHEMA_ID = schemaId.trim()
      if (datasetId.trim()) payload.AEP_PROFILE_DATASET_ID = datasetId.trim()

      const res = await actionWebInvoke(actions['profile-lab-update'], headers, payload, { method: 'POST' })

      const nextBaseline = { ...baselineValues }
      for (const field of fields) {
        if (!valuesEqual(baselineValues[field.path], formValues[field.path])) {
          nextBaseline[field.path] = formValues[field.path]
        }
      }
      setBaselineValues(nextBaseline)
      setStatus(res?.note || 'Update submitted.')
    } catch (e) {
      setErr(e?.message || 'Update failed')
      setStatus('')
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function renderInput (field) {
    const path = field.path
    const type = String(field.type || '').toLowerCase()
    const value = formValues[path]
    const help = fieldHelpText(field)

    if (type === 'boolean') {
      return (
        <View key={path}>
          <Checkbox isSelected={Boolean(value)} onChange={(v) => onFieldChange(path, v)} onKeyDown={(e) => onFieldUndo(e, path)}>
            {fieldLabel(field)}
          </Checkbox>
          {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>{help}</Text> : null}
        </View>
      )
    }

    if (field?.enum?.length) {
      return (
        <View key={path}>
          <Picker
            label={fieldLabel(field)}
            selectedKey={String(value || '')}
            onSelectionChange={(k) => onFieldChange(path, String(k || ''))}
            width='100%'
          >
            <Item key=''>--</Item>
            {field.enum.map((opt) => <Item key={opt}>{opt}</Item>)}
          </Picker>
          {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>{help}</Text> : null}
        </View>
      )
    }

    if (isDateType(field)) {
      const dateValue = String(value || '').slice(0, 10)
      return (
        <View key={path}>
          <Text>{fieldLabel(field)}</Text>
          <input
            type='date'
            value={dateValue}
            onChange={(e) => onFieldChange(path, e.target.value)}
            onKeyDown={(e) => onFieldUndo(e, path)}
            style={{ width: '100%', minHeight: 32, padding: 6, borderRadius: 4, border: '1px solid var(--spectrum-global-color-gray-400)' }}
          />
          <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>
            {field.format === 'date-time' ? 'Saved as date-time (T00:00:00Z).' : 'Saved as date.'}
          </Text>
        </View>
      )
    }

    if (isNumericType(type)) {
      return (
        <View key={path}>
          <NumberField
            label={fieldLabel(field)}
            value={value === '' ? undefined : Number(value)}
            onChange={(v) => onFieldChange(path, Number.isFinite(v) ? v : '')}
            onKeyDown={(e) => onFieldUndo(e, path)}
            width='100%'
          />
          {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>{help}</Text> : null}
        </View>
      )
    }

    if (type === 'array') {
      const itemType = String(field?.itemType || '').toLowerCase()
      const label = itemType && itemType !== 'string'
        ? `${fieldLabel(field)} (JSON array)`
        : `${fieldLabel(field)} (one per line)`

      return (
        <View key={path}>
          <TextArea
            label={label}
            value={String(value ?? '')}
            onChange={(v) => onFieldChange(path, v)}
            onKeyDown={(e) => onFieldUndo(e, path)}
            width='100%'
            minHeight='size-1000'
          />
          {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>{help}</Text> : null}
        </View>
      )
    }

    if (type === 'object') {
      return (
        <View key={path}>
          <TextArea
            label={`${fieldLabel(field)} (JSON object)`}
            value={String(value ?? '')}
            onChange={(v) => onFieldChange(path, v)}
            onKeyDown={(e) => onFieldUndo(e, path)}
            width='100%'
            minHeight='size-1200'
          />
          {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>{help}</Text> : null}
        </View>
      )
    }

    return (
      <View key={path}>
        <TextField
          label={fieldLabel(field)}
          value={String(value ?? '')}
          onChange={(v) => onFieldChange(path, v)}
          onKeyDown={(e) => onFieldUndo(e, path)}
          width='100%'
        />
        {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11 }}>{help}</Text> : null}
      </View>
    )
  }

  return (
    <View>
      <Heading level={2}>Edit Test Profile</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Fields are grouped by schema path. Current profile values are loaded by default.
      </Text>
      <Divider size='S' marginY='size-200' />

      <Flex direction='column' gap='size-150'>
        <View>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <TextField label='Schema ID' value={schemaId} onChange={setSchemaId} width='100%' />
            <TextField label='Dataset ID' value={datasetId} onChange={setDatasetId} width='100%' />
          </div>
        </View>

        <Flex gap='size-100' wrap>
          <Button variant='secondary' onPress={loadSchema} isDisabled={isLoading || isSaving}>Load Schema Fields</Button>
          <Button variant='secondary' onPress={() => loadCurrentValues()} isDisabled={isLoading || isSaving || !fields.length}>Load Current Values</Button>
          <Button variant='secondary' onPress={loadAll} isDisabled={isLoading || isSaving}>Load All</Button>
        </Flex>

        <Divider size='S' />

        <View>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <TextField label='Identity Namespace' value={identityNs} onChange={setIdentityNs} width='100%' />
            <TextField label='Identity Value' value={identityValue} onChange={setIdentityValue} width='100%' />
          </div>
        </View>

        {isLoading ? (
          <Flex alignItems='center' gap='size-100'>
            <ProgressCircle size='S' isIndeterminate />
            <Text>Loading...</Text>
          </Flex>
        ) : null}

        {sections.length ? (
          <Flex direction='column' gap='size-200'>
            {sections.map((section) => (
              <View key={section.key} borderWidth='thin' borderColor='dark' borderRadius='small' padding='size-175'>
                <Heading level={4}>{section.title}</Heading>
                <Text UNSAFE_style={{ opacity: 0.72, fontSize: 11, marginBottom: 10 }}>
                  {section.key === '__root__' ? 'Top-level profile attributes.' : section.key}
                </Text>

                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
                  {section.fields.map(renderInput)}
                </div>
              </View>
            ))}
          </Flex>
        ) : (
          <Text UNSAFE_style={{ opacity: 0.75 }}>No fields loaded yet.</Text>
        )}

        <Flex gap='size-100' wrap>
          <Button variant='cta' onPress={saveChanges} isDisabled={isLoading || isSaving || !identityNs.trim() || !identityValue.trim() || !fields.length}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button variant='secondary' onPress={() => nav('/profile-lab')}>Back to Search</Button>
        </Flex>

        {status ? <StatusLight variant='positive'>{status}</StatusLight> : null}
        {err ? <StatusLight variant='negative'>{err}</StatusLight> : null}
      </Flex>
    </View>
  )
}



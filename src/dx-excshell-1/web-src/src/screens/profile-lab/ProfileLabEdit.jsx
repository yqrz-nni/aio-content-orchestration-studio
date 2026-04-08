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
import { computeDerivedSignals } from './simulation/engine'

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

function hasMeaningfulValue (v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return false
}

function normalizeValueByMeta (meta, value) {
  const type = String(meta?.type || '').toLowerCase()

  if (value === undefined || value === null) {
    if (type === 'boolean') return false
    return ''
  }

  if (isDateType(meta)) return String(value)

  if (isNumericType(type)) {
    if (typeof value === 'number') return value
    const n = Number(value)
    return Number.isFinite(n) ? n : ''
  }

  if (type === 'boolean') return Boolean(value)
  return String(value)
}

function emptyValueByMeta (meta) {
  const type = String(meta?.type || '').toLowerCase()
  if (type === 'boolean') return false
  return ''
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

    if (itemType === 'object') {
      const itemFields = Array.isArray(field?.itemFields) ? field.itemFields : []
      if (!itemFields.length) return value

      return value.map((row) => {
        const nextRow = {}
        for (const itemField of itemFields) {
          const raw = getByPath(row, itemField.path)
          const normalized = normalizeValueByMeta(itemField, raw)
          setByPath(nextRow, itemField.path, normalized)
        }
        return nextRow
      })
    }

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
    if (itemType === 'object') {
      if (!Array.isArray(value)) {
        const text = String(value || '').trim()
        if (!text) return []
        return JSON.parse(text)
      }

      const itemFields = Array.isArray(field?.itemFields) ? field.itemFields : []
      if (!itemFields.length) return value

      const rows = []
      for (const row of value) {
        const next = {}
        for (const itemField of itemFields) {
          const raw = getByPath(row, itemField.path)
          const converted = valueForSave(itemField, raw)
          if (hasMeaningfulValue(converted)) setByPath(next, itemField.path, converted)
        }
        if (Object.keys(next).length) rows.push(next)
      }
      return rows
    }

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
  if (currentNovo?.email) return 'Email'
  if (currentNovo?.novoMedlinkId) return '__tenant__'
  return '__tenant__'
}

function guessIdentityValue (decodedProfileId, currentNovo, ns) {
  if (ns === 'Email') return currentNovo?.email || decodedProfileId || ''
  if (ns === '__tenant__') return currentNovo?.novoMedlinkId || decodedProfileId || ''
  return decodedProfileId || ''
}

function toLookupPayload (decodedProfileId) {
  const id = String(decodedProfileId || '').trim()
  if (!id) return null
  if (id.includes('@')) return { emails: [id.toLowerCase()] }
  return { entityId: id, entityIdNS: '__tenant__' }
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

const DERIVED_PATH_PREFIXES = [
  'hcpDemo.demoData.scores.contentAffinity',
  'hcpDemo.demoData.scores.portfolioAffinity',
  'hcpDemo.demoData.scores.engagementState',
  'hcpDemo.demoData.scores.brandScores'
]

function isDerivedFieldPath(path) {
  const p = String(path || '')
  return DERIVED_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target

  for (const [key, val] of Object.entries(source)) {
    if (Array.isArray(val)) {
      target[key] = val
      continue
    }

    if (val && typeof val === 'object') {
      const base = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {}
      target[key] = deepMerge(base, val)
      continue
    }

    target[key] = val
  }

  return target
}

function formatScore(value, max = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  if (max === 10) return n.toFixed(1)
  return n.toFixed(2)
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

  const [identityNs, setIdentityNs] = useState('__tenant__')
  const [identityValue, setIdentityValue] = useState(decodedProfileId)

  const [baselineValues, setBaselineValues] = useState({})
  const [formValues, setFormValues] = useState({})
  const [loadedNovo, setLoadedNovo] = useState({})

  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('Load schema and current profile attributes to begin editing.')
  const [err, setErr] = useState('')
  const [expandedSections, setExpandedSections] = useState({})

  const editableFields = useMemo(() => fields.filter((f) => !isDerivedFieldPath(f?.path)), [fields])
  const sections = useMemo(() => groupFields(editableFields), [editableFields])

  const simulation = useMemo(() => {
    const workingNovo = JSON.parse(JSON.stringify(loadedNovo || {}))

    for (const field of fields) {
      const current = formValues[field.path]
      let converted

      try {
        converted = valueForSave(field, current)
      } catch (e) {
        continue
      }

      if (converted === null) continue
      setByPath(workingNovo, field.path, converted)
    }

    if (!String(workingNovo?.novoMedlinkId || '').trim()) {
      const fallbackNovoMedlinkId = String(
        formValues?.novoMedlinkId || baselineValues?.novoMedlinkId || (identityNs.trim() === '__tenant__' ? identityValue.trim() : '')
      ).trim()
      if (fallbackNovoMedlinkId) workingNovo.novoMedlinkId = fallbackNovoMedlinkId
    }

    return computeDerivedSignals(workingNovo)
  }, [loadedNovo, fields, formValues, baselineValues, identityNs, identityValue])

  
  function toggleSection(sectionKey) {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
  }
function onFieldChange (path, value) {
    setFormValues((prev) => ({ ...prev, [path]: value }))
  }

  function onFieldUndo (e, path) {
    const isUndo = (e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'z'
    if (!isUndo) return
    e.preventDefault()
    onFieldChange(path, baselineValues[path])
  }

  function onArrayObjectItemChange (path, index, itemPath, value) {
    setFormValues((prev) => {
      const list = Array.isArray(prev[path]) ? [...prev[path]] : []
      while (list.length <= index) list.push({})
      const row = { ...(list[index] || {}) }
      setByPath(row, itemPath, value)
      list[index] = row
      return { ...prev, [path]: list }
    })
  }

  function onArrayObjectAddItem (path, field) {
    const itemFields = Array.isArray(field?.itemFields) ? field.itemFields : []
    const emptyItem = {}
    for (const itemField of itemFields) {
      setByPath(emptyItem, itemField.path, emptyValueByMeta(itemField))
    }

    setFormValues((prev) => {
      const list = Array.isArray(prev[path]) ? [...prev[path]] : []
      list.push(emptyItem)
      return { ...prev, [path]: list }
    })
  }

  function onArrayObjectRemoveItem (path, index) {
    setFormValues((prev) => {
      const list = Array.isArray(prev[path]) ? [...prev[path]] : []
      if (index < 0 || index >= list.length) return prev
      list.splice(index, 1)
      return { ...prev, [path]: list }
    })
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

    if (schemaId.trim()) payload.schemaId = schemaId.trim()
    if (datasetId.trim()) payload.datasetId = datasetId.trim()

    try {
      setIsLoading(true)
      setErr('')
      setStatus('Loading current profile attributes...')

      let res = await actionWebInvoke(actions['profile-lab-direct-read'], headers, payload, { method: 'POST' })
      let first = Array.isArray(res?.items) && res.items.length ? res.items[0] : null

      if (!first && !decodedProfileId.includes('@')) {
        const fallbackPayload = {
          entityId: decodedProfileId,
          entityIdNS: '__tenant__'
        }
        if (schemaId.trim()) fallbackPayload.schemaId = schemaId.trim()
        if (datasetId.trim()) fallbackPayload.datasetId = datasetId.trim()

        res = await actionWebInvoke(actions['profile-lab-direct-read'], headers, fallbackPayload, { method: 'POST' })
        first = Array.isArray(res?.items) && res.items.length ? res.items[0] : null
      }

      const currentNovo = first?.rawNovo || {}
      setLoadedNovo(currentNovo)

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

      const mergedNovo = JSON.parse(JSON.stringify(loadedNovo || {}))
      const beforeSnapshot = JSON.stringify(mergedNovo)
      let hasChanges = false

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
        setByPath(mergedNovo, path, converted)
        hasChanges = true
      }

      if (!String(mergedNovo?.novoMedlinkId || '').trim()) {
        const fallbackNovoMedlinkId = String(
          formValues?.novoMedlinkId || baselineValues?.novoMedlinkId || (identityNs.trim() === '__tenant__' ? identityValue.trim() : '')
        ).trim()

        if (fallbackNovoMedlinkId) {
          mergedNovo.novoMedlinkId = fallbackNovoMedlinkId
        }
      }

      const derivedResult = computeDerivedSignals(mergedNovo)
      deepMerge(mergedNovo, derivedResult.derivedPatch)
      const changedByDerived = JSON.stringify(mergedNovo) !== beforeSnapshot

      if (!hasChanges && !changedByDerived) {
        setStatus('No changes detected.')
        return
      }
      const payload = {
        identityNs: identityNs.trim(),
        identityValue: identityValue.trim(),
        attributes: { _novo: mergedNovo },
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
      setLoadedNovo(mergedNovo)
      setStatus(res?.note || 'Update submitted.')
    } catch (e) {
      setErr(e?.message || 'Update failed')
      setStatus('')
    } finally {
      setIsSaving(false)
    }
  }
  useEffect(() => {
    if (!sections.length) return
    setExpandedSections((prev) => {
      const next = { ...prev }
      for (const section of sections) {
        if (!(section.key in next)) next[section.key] = true
      }
      return next
    })
  }, [sections])
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

      if (itemType === 'object' && Array.isArray(field?.itemFields) && field.itemFields.length) {
        const rows = Array.isArray(value) ? value : []
        return (
          <View key={path} UNSAFE_style={{ gridColumn: '1 / -1' }}>
            <Flex direction='row' justifyContent='space-between' alignItems='end'>
              <Heading level={5}>{fieldLabel(field)}</Heading>
              <Button variant='secondary' onPress={() => onArrayObjectAddItem(path, field)}>
                Add Entry
              </Button>
            </Flex>
            {help ? <Text UNSAFE_style={{ opacity: 0.7, fontSize: 11, marginBottom: 8 }}>{help}</Text> : null}

            <Flex direction='column' gap='size-150' UNSAFE_style={{ height: '100%' }}>
              {rows.length === 0 ? (
                <Text UNSAFE_style={{ opacity: 0.75 }}>No entries yet.</Text>
              ) : (
                rows.map((row, index) => (
                  <View key={`${path}-${index}`} borderWidth='thin' borderColor='medium' borderRadius='small' padding='size-150'>
                    <Flex direction='row' justifyContent='space-between' alignItems='center' marginBottom='size-100'>
                      <Text><strong>Entry {index + 1}</strong></Text>
                      <Button variant='negative' onPress={() => onArrayObjectRemoveItem(path, index)}>Remove</Button>
                    </Flex>
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                      {field.itemFields.map((itemField) => {
                        const itemValue = getByPath(row, itemField.path)
                        const itemTypeLocal = String(itemField.type || '').toLowerCase()
                        const label = itemField.title || itemField.path
                        const itemKey = `${path}-${index}-${itemField.path}`

                        if (itemTypeLocal === 'boolean') {
                          return (
                            <View key={itemKey}>
                              <Checkbox
                                isSelected={Boolean(itemValue)}
                                onChange={(v) => onArrayObjectItemChange(path, index, itemField.path, v)}
                                onKeyDown={(e) => onFieldUndo(e, path)}
                              >
                                {label}
                              </Checkbox>
                            </View>
                          )
                        }

                        if (itemField?.enum?.length) {
                          return (
                            <View key={itemKey}>
                              <Picker
                                label={label}
                                selectedKey={String(itemValue || '')}
                                onSelectionChange={(k) => onArrayObjectItemChange(path, index, itemField.path, String(k || ''))}
                                width='100%'
                              >
                                <Item key=''>--</Item>
                                {itemField.enum.map((opt) => <Item key={opt}>{opt}</Item>)}
                              </Picker>
                            </View>
                          )
                        }

                        if (isDateType(itemField)) {
                          const dateValue = String(itemValue || '').slice(0, 10)
                          return (
                            <View key={itemKey}>
                              <Text>{label}</Text>
                              <input
                                type='date'
                                value={dateValue}
                                onChange={(e) => onArrayObjectItemChange(path, index, itemField.path, e.target.value)}
                                onKeyDown={(e) => onFieldUndo(e, path)}
                                style={{ width: '100%', minHeight: 32, padding: 6, borderRadius: 4, border: '1px solid var(--spectrum-global-color-gray-400)' }}
                              />
                            </View>
                          )
                        }

                        if (isNumericType(itemTypeLocal)) {
                          return (
                            <NumberField
                              key={itemKey}
                              label={label}
                              value={itemValue === '' || itemValue === undefined ? undefined : Number(itemValue)}
                              onChange={(v) => onArrayObjectItemChange(path, index, itemField.path, Number.isFinite(v) ? v : '')}
                              onKeyDown={(e) => onFieldUndo(e, path)}
                              width='100%'
                            />
                          )
                        }

                        return (
                          <TextField
                            key={itemKey}
                            label={label}
                            value={String(itemValue ?? '')}
                            onChange={(v) => onArrayObjectItemChange(path, index, itemField.path, v)}
                            onKeyDown={(e) => onFieldUndo(e, path)}
                            width='100%'
                          />
                        )
                      })}
                    </div>
                  </View>
                ))
              )}
            </Flex>
          </View>
        )
      }

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
    <View UNSAFE_style={{ height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
      <Heading level={2}>Edit Test Profile</Heading>
      <Text UNSAFE_style={{ opacity: 0.85 }}>
        Fields are grouped by schema path. Current profile values are loaded by default.
      </Text>
      <Divider size='S' marginY='size-200' />

      <Flex direction='column' gap='size-150' UNSAFE_style={{ height: '100%' }}>
        <View
          borderWidth='thin'
          borderColor='medium'
          borderRadius='small'
          padding='size-150'
          UNSAFE_style={{ position: 'sticky', top: 8, zIndex: 10, background: 'var(--spectrum-global-color-gray-50)' }}
        >
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <TextField label='Identity Namespace' value={identityNs} onChange={setIdentityNs} width='100%' />
            <TextField label='Identity Value' value={identityValue} onChange={setIdentityValue} width='100%' />
          </div>

          <Flex gap='size-100' marginTop='size-125' wrap>
            <Button variant='secondary' onPress={() => loadCurrentValues()} isDisabled={isLoading || isSaving || !fields.length}>Reload Current Values</Button>
          </Flex>
        </View>
        {isLoading ? (
          <Flex alignItems='center' gap='size-100'>
            <ProgressCircle size='S' isIndeterminate />
            <Text>Loading...</Text>
          </Flex>
        ) : null}

        {sections.length ? (
          <Flex direction='row' gap='size-200' alignItems='start' UNSAFE_style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
            <View
              borderWidth='thin'
              borderColor='dark'
              borderRadius='small'
              padding='size-175'
              UNSAFE_style={{ flex: '1 1 760px', minWidth: 0, overflow: 'auto', maxHeight: '100%' }}
            >
              <Flex direction='row' justifyContent='space-between' alignItems='center' wrap gap='size-100'>
                <Heading level={4}>Test Profile Data</Heading>
                <Flex gap='size-100' wrap>
                  <Button variant='cta' onPress={saveChanges} isDisabled={isLoading || isSaving || !identityNs.trim() || !identityValue.trim() || !fields.length}>
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button variant='secondary' onPress={() => nav('/profile-lab')}>Back to Search</Button>
                </Flex>
              </Flex>
              <Flex direction='column' gap='size-125'>
                {sections.map((section) => {
                  const isOpen = expandedSections[section.key] !== false
                  return (
                    <View key={section.key} borderWidth='thin' borderColor='dark' borderRadius='small' padding='size-125'>
                      <Flex direction='row' justifyContent='space-between' alignItems='center' gap='size-100'>
                        <View>
                          <Text><strong>{section.title}</strong></Text>
                          <Text UNSAFE_style={{ opacity: 0.72, fontSize: 11 }}>
                            {section.key === '__root__' ? 'Top-level profile attributes.' : section.key}
                          </Text>
                        </View>
                        <Button variant='secondary' onPress={() => toggleSection(section.key)}>
                          {isOpen ? 'Collapse' : 'Expand'}
                        </Button>
                      </Flex>

                      {isOpen ? (
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 12 }}>
                          {section.fields.map(renderInput)}
                        </div>
                      ) : null}
                    </View>
                  )
                })}
              </Flex>
            </View>

            <View
              borderWidth='thin'
              borderColor='medium'
              borderRadius='small'
              padding='size-175'
              UNSAFE_style={{ flex: '1 1 360px', minWidth: 300, overflow: 'auto', maxHeight: '100%', background: 'var(--spectrum-global-color-gray-50)' }}
            >
              <Heading level={4}>Simulated Outcomes</Heading>

              <View borderWidth='thin' borderColor='light' borderRadius='small' padding='size-125' marginBottom='size-125'>
                <Text><strong>Engagement State</strong></Text>
                <View borderWidth='thin' borderColor='light' borderRadius='small' padding='size-100' marginTop='size-75'>
                  <Text>ownedChannels</Text>
                  <Text UNSAFE_style={{ fontSize: 12, opacity: 0.9 }}>{simulation?.preview?.engagementState?.ownedChannels || '-'}</Text>
                </View>
              </View>

              <View borderWidth='thin' borderColor='light' borderRadius='small' padding='size-125' marginBottom='size-125'>
                <Text><strong>Content Affinity</strong></Text>
                <Flex direction='column' gap='size-75' marginTop='size-75'>
                  {Object.entries(simulation?.preview?.contentAffinity || {}).map(([k, v]) => (
                    <View key={k} borderWidth='thin' borderColor='light' borderRadius='small' padding='size-100'>
                      <Text>{k}</Text>
                      <Text UNSAFE_style={{ fontSize: 12, opacity: 0.9 }}>{formatScore(v, k === 'samples' ? 10 : 1)}</Text>
                    </View>
                  ))}
                  <View borderWidth='thin' borderColor='light' borderRadius='small' padding='size-100'>
                    <Text>portfolioAffinity</Text>
                    <Text UNSAFE_style={{ fontSize: 12, opacity: 0.9 }}>{formatScore(simulation?.preview?.portfolioAffinity, 1)}</Text>
                  </View>
                </Flex>
              </View>

              <View borderWidth='thin' borderColor='light' borderRadius='small' padding='size-125' marginBottom='size-125'>
                <Text><strong>Brand Scores</strong></Text>
                {(simulation?.preview?.brandScores || []).length ? (
                  <Flex direction='column' gap='size-100' marginTop='size-75'>
                    {(simulation?.preview?.brandScores || []).map((score) => (
                      <View key={score.brandId} borderWidth='thin' borderColor='light' borderRadius='small' padding='size-100'>
                        <Text><strong>{score.brandId}</strong></Text>
                        <Text UNSAFE_style={{ fontSize: 11, opacity: 0.85 }}>NBRx: {score.nbrxDirection} / {score.nbrxState}</Text>
                        <Text UNSAFE_style={{ fontSize: 11, opacity: 0.85 }}>RBRx: {score.rbrxDirection} / {score.rbrxState}</Text>
                        <Text UNSAFE_style={{ fontSize: 11, opacity: 0.85 }}>TRx: {score.trxDirection} / {score.trxState}</Text>
                      </View>
                    ))}
                  </Flex>
                ) : (
                  <Text UNSAFE_style={{ opacity: 0.75, marginTop: 8 }}>No brandSignals found to derive brandScores.</Text>
                )}
              </View>

              <View borderWidth='thin' borderColor='light' borderRadius='small' padding='size-125'>
                <Text><strong>Why these values?</strong></Text>
                <Flex direction='column' gap='size-75' marginTop='size-75'>
                  {(simulation?.explanations || []).map((line, idx) => (
                    <View key={`sim-exp-${idx}`} borderWidth='thin' borderColor='light' borderRadius='small' padding='size-100'>
                      <Text UNSAFE_style={{ fontSize: 11, opacity: 0.85 }}>{line}</Text>
                    </View>
                  ))}
                </Flex>
              </View>
            </View>
          </Flex>
        ) : (
          <Text UNSAFE_style={{ opacity: 0.75 }}>No fields loaded yet.</Text>
        )}

        {status ? <StatusLight variant='positive'>{status}</StatusLight> : null}
        {err ? <StatusLight variant='negative'>{err}</StatusLight> : null}
      </Flex>
    </View>
  )
}





const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { requireIms } = require('../../../_lib/ims')
const { fetchJson } = require('../../../_lib/fetchJson')

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

function findNovoNodes(root, out = []) {
  if (!isObject(root)) return out

  if (isObject(root._novo)) out.push(root._novo)

  for (const val of Object.values(root)) {
    if (isObject(val)) findNovoNodes(val, out)
    else if (Array.isArray(val)) {
      for (const item of val) if (isObject(item)) findNovoNodes(item, out)
    }
  }

  return out
}

function inferType(def) {
  return String(def?.type || def?.['meta:xdmType'] || '').toLowerCase() || 'string'
}

function resolveJsonPointer(root, pointer) {
  if (!pointer || pointer[0] !== '#') return null
  const parts = pointer.slice(1).split('/').filter(Boolean).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))

  let cur = root
  for (const part of parts) {
    if (!isObject(cur) || !(part in cur)) return null
    cur = cur[part]
  }

  return cur
}

function extractProperties(node, rootNode = node, seen = new Set()) {
  if (!isObject(node)) return {}

  const out = {}

  if (isObject(node.properties)) {
    Object.assign(out, node.properties)
  }

  if (Array.isArray(node.allOf)) {
    for (const part of node.allOf) {
      let resolved = part
      if (isObject(part) && typeof part.$ref === 'string' && part.$ref.startsWith('#/')) {
        if (seen.has(part.$ref)) continue
        seen.add(part.$ref)
        resolved = resolveJsonPointer(rootNode, part.$ref)
      }

      const partProps = extractProperties(resolved, rootNode, seen)
      Object.assign(out, partProps)
    }
  }

  return out
}

function normalizeRefBase(registryBase, kind) {
  // from .../tenant/schemas => .../tenant/{kind}
  if (/\/tenant\/schemas\/?$/i.test(registryBase)) {
    return registryBase.replace(/\/tenant\/schemas\/?$/i, `/tenant/${kind}`)
  }

  // fallback for already-rooted registry base
  return `${registryBase.replace(/\/$/, '')}/${kind}`
}

function inferRefKind(ref) {
  const s = String(ref || '')
  if (s.includes('/datatypes/')) return 'datatypes'
  if (s.includes('/mixins/')) return 'mixins'
  if (s.includes('/classes/')) return 'classes'
  if (s.includes('/schemas/')) return 'schemas'
  return null
}

function createRefResolver({ registryBase, headers }) {
  const cache = new Map()

  async function resolveRef(ref) {
    const key = String(ref || '').trim()
    if (!key) return null
    if (cache.has(key)) return cache.get(key)

    const kind = inferRefKind(key)
    if (!kind) {
      cache.set(key, null)
      return null
    }

    const base = normalizeRefBase(registryBase, kind)
    const url = `${base}/${encodeURIComponent(key)}`

    try {
      const payload = await fetchJson(url, {
        method: 'GET',
        headers
      })
      cache.set(key, payload)
      return payload
    } catch (e) {
      cache.set(key, null)
      return null
    }
  }

  return { resolveRef }
}

function buildField(def, path) {
  const type = inferType(def)
  const field = {
    path,
    title: def?.title || path.split('.').pop() || path,
    type,
    format: def?.format || null,
    enum: Array.isArray(def?.enum) ? def.enum : null
  }

  if (type === 'array') {
    const itemDef = isObject(def?.items) ? def.items : {}
    field.itemType = inferType(itemDef)
    field.itemEnum = Array.isArray(itemDef?.enum) ? itemDef.enum : null
    field.itemRef = itemDef?.$ref || null
    field.itemFields = []
  }

  if (type === 'object' && def?.$ref) field.ref = def.$ref

  return field
}

async function resolveObjectDef(def, resolver, visitedRefs = new Set()) {
  if (!isObject(def)) return null
  if (isObject(def.properties) || (Array.isArray(def.allOf) && def.allOf.length)) return def

  const ref = String(def.$ref || '').trim()
  if (!ref || visitedRefs.has(ref)) return null
  visitedRefs.add(ref)

  return resolver.resolveRef(ref)
}

async function collectLeafFields(node, prefix = '', out = [], resolver, visitedRefs = new Set()) {
  if (!isObject(node)) return out

  const properties = extractProperties(node, node)
  for (const [key, def] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    const type = inferType(def)

    if (type === 'object') {
      const objDef = await resolveObjectDef(def, resolver, visitedRefs)
      if (objDef) {
        await collectLeafFields(objDef, path, out, resolver, new Set(visitedRefs))
        continue
      }

      out.push(buildField(def, path))
      continue
    }

    if (type === 'array') {
      const field = buildField(def, path)
      const itemDef = isObject(def?.items) ? def.items : {}

      if (field.itemType === 'object') {
        const itemObjDef = await resolveObjectDef(itemDef, resolver, new Set(visitedRefs))
        if (itemObjDef) {
          const itemFields = []
          await collectLeafFields(itemObjDef, '', itemFields, resolver, new Set(visitedRefs))
          field.itemFields = itemFields
        }
      }

      out.push(field)
      continue
    }

    out.push(buildField(def, path))
  }

  return out
}

function uniqByPath(fields) {
  const byPath = new Map()
  for (const f of fields) {
    if (!f?.path) continue
    if (!byPath.has(f.path)) byPath.set(f.path, f)
  }
  return [...byPath.values()]
}

function isSimpleHash(v) {
  return /^[a-f0-9]{16,}$/i.test(String(v || ''))
}

function buildSchemaCandidates(schemaId, tenantNamespace) {
  const trimmed = String(schemaId || '').trim()
  if (!trimmed) return []

  const candidates = [trimmed]

  if (isSimpleHash(trimmed) && tenantNamespace) {
    const tenant = String(tenantNamespace).trim().replace(/^_/, '')
    candidates.push(`https://ns.adobe.com/${tenant}/schemas/${trimmed}`)
    candidates.push(`_${tenant}.schemas.${trimmed}`)
  }

  return Array.from(new Set(candidates))
}

async function fetchSchemaWithFallback({ candidates, registryBase, headers }) {
  let lastErr = null

  for (const candidate of candidates) {
    const url = `${registryBase}/${encodeURIComponent(candidate)}`
    try {
      const schemaPayload = await fetchJson(url, {
        method: 'GET',
        headers
      })
      return { schemaPayload, resolvedSchemaId: candidate }
    } catch (e) {
      lastErr = e
      if (e?.status !== 404) throw e
    }
  }

  throw lastErr || new Error('Schema not found for provided identifier.')
}

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') return corsPreflight()

  try {
    const { token, imsOrg } = requireIms(params)

    const apiKey = String(params.AEP_API_KEY || params.CLIENT_ID || '').trim()
    const sandboxName = String(params.AEP_SANDBOX_NAME || params.SANDBOX_NAME || '').trim()
    const schemaId = String(params.schemaId || params.AEP_XDM_SCHEMA_ID || '').trim()
    const datasetId = String(params.datasetId || params.AEP_PROFILE_DATASET_ID || '').trim()
    const tenantNamespace = String(params.AIO_TENANT_NAMESPACE || '').trim()
    const registryBase = String(params.AEP_SCHEMA_REGISTRY_BASE || 'https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas').replace(/\/$/, '')

    if (!apiKey) return badRequest('Missing AEP_API_KEY (or CLIENT_ID input).')
    if (!sandboxName) return badRequest('Missing AEP_SANDBOX_NAME (or SANDBOX_NAME input).')
    if (!schemaId) return badRequest('Missing AEP_XDM_SCHEMA_ID.')

    const headers = {
      Authorization: token,
      'x-api-key': apiKey,
      'x-gw-ims-org-id': imsOrg,
      'x-sandbox-name': sandboxName,
      accept: 'application/vnd.adobe.xed-full+json; version=1'
    }

    const candidates = buildSchemaCandidates(schemaId, tenantNamespace)
    const { schemaPayload, resolvedSchemaId } = await fetchSchemaWithFallback({
      candidates,
      registryBase,
      headers
    })

    const resolver = createRefResolver({ registryBase, headers })
    const novoNodes = findNovoNodes(schemaPayload)
    const collected = []

    for (const node of novoNodes) {
      await collectLeafFields(node, '', collected, resolver)
    }

    const fields = uniqByPath(collected).sort((a, b) => a.path.localeCompare(b.path))

    return ok({
      schemaId: resolvedSchemaId,
      datasetId: datasetId || null,
      fieldCount: fields.length,
      fields
    })
  } catch (e) {
    return serverError(e.message, { status: e.status, url: e.url, responseText: e.responseText, data: e.data })
  }
}

exports.main = main

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

function pushField(def, path, out) {
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
  }

  if (type === 'object' && def?.$ref) field.ref = def.$ref

  out.push(field)
}

function collectLeafFields(node, prefix = '', out = []) {
  if (!isObject(node)) return out

  const properties = isObject(node.properties) ? node.properties : null
  if (!properties) return out

  for (const [key, def] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    const type = inferType(def)

    if (type === 'object' && isObject(def?.properties)) {
      collectLeafFields(def, path, out)
      continue
    }

    pushField(def, path, out)
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

    const novoNodes = findNovoNodes(schemaPayload)
    const collected = []
    for (const node of novoNodes) collectLeafFields(node, '', collected)

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

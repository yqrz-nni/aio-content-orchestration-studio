const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { requireIms } = require('../../../_lib/ims')
const { fetchJson } = require('../../../_lib/fetchJson')

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

function getTenantNamespace(params) {
  const explicitNs = String(params?.AIO_TENANT_NAMESPACE || '').trim().replace(/^_/, '')
  if (explicitNs) return explicitNs

  const schemaId = String(params?.AEP_XDM_SCHEMA_ID || params?.schemaId || '').trim()
  const m = schemaId.match(/^https:\/\/ns\.adobe\.com\/([^\/]+)\/schemas\//i)
  return m && m[1] ? String(m[1]).replace(/^_/, '') : ''
}

function resolveNamespaceCode(code, params) {
  const raw = String(code || '').trim()
  const tenantNs = getTenantNamespace(params)

  if (raw === '__tenant__') return tenantNs || raw
  if (raw === 'novoMedlinkId' && tenantNs) return tenantNs

  return raw
}

function namespaceCandidates(nsCode) {
  const raw = String(nsCode || '').trim()
  if (!raw || raw === 'Email') return [raw]

  const base = raw.replace(/^[@_]+/, '')
  const out = [raw]
  if (base && base !== raw) out.push(base)
  if (base) out.push(`@${base}`)
  if (base) out.push(`_${base}`)

  return Array.from(new Set(out.filter(Boolean)))
}

function cloneWithNamespace(identities, fromNs, toNs) {
  return identities.map((x) => {
    const current = String(x?.entityIdNS?.code || '').trim()
    if (current !== fromNs) return x

    return {
      ...x,
      entityIdNS: { code: toNs }
    }
  })
}

function toIdentityObjects(params) {
  if (Array.isArray(params.identities) && params.identities.length) {
    return params.identities
      .map((x) => ({
        entityId: String(x?.entityId || '').trim(),
        entityIdNS: { code: resolveNamespaceCode(String(x?.entityIdNS?.code || x?.entityIdNS || '').trim(), params) }
      }))
      .filter((x) => x.entityId && x.entityIdNS.code)
  }

  if (Array.isArray(params.emails) && params.emails.length) {
    return params.emails
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ entityId: email, entityIdNS: { code: 'Email' } }))
  }

  const entityId = String(params.entityId || '').trim()
  const entityIdNS = resolveNamespaceCode(String(params.entityIdNS || '').trim(), params)
  if (entityId && entityIdNS) {
    return [{ entityId, entityIdNS: { code: entityIdNS } }]
  }

  return []
}

function isInvalidNamespaceError(e) {
  if (e?.status !== 400) return false
  const code = String(e?.data?.['error-code'] || '').toLowerCase()
  const msg = String(e?.data?.message || e?.data?.['error-message'] || e?.message || '').toLowerCase()
  return code.includes('uplib-101722-400') || msg.includes('namespace code is invalid') || msg.includes('namespace')
}
function normalizeEntity(payloadObj) {
  const entity = payloadObj?.entity || {}
  const novo = entity?._novo || {}

  return {
    profileId: novo?.testProfileId || novo?.novoMedlinkId || payloadObj?.entityId || null,
    testProfileId: novo?.testProfileId || null,
    novoMedlinkId: novo?.novoMedlinkId || null,
    email: novo?.email || null,
    name: novo?.name || null,
    status: novo?.status || null,
    channel: novo?.channel || null,
    tags: Array.isArray(novo?.tags) ? novo.tags : [],
    rawNovo: novo
  }
}

async function callProfileAccess({ url, token, apiKey, imsOrg, sandboxName, identities, fields }) {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: token,
      'x-api-key': apiKey,
      'x-gw-ims-org-id': imsOrg,
      'x-sandbox-name': sandboxName,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      schema: { name: '_xdm.context.profile' },
      fields,
      identities
    })
  })
}

async function fetchWithNamespaceFallback(args) {
  const { identities } = args
  const firstNonEmail = identities.find((x) => String(x?.entityIdNS?.code || '').trim() !== 'Email')
  const currentNs = String(firstNonEmail?.entityIdNS?.code || '').trim()

  if (!currentNs) {
    const data = await callProfileAccess(args)
    return { data, usedNamespace: null }
  }

  const candidates = namespaceCandidates(currentNs)
  let lastErr = null

  for (const candidate of candidates) {
    try {
      const adjusted = candidate === currentNs ? identities : cloneWithNamespace(identities, currentNs, candidate)
      const data = await callProfileAccess({ ...args, identities: adjusted })
      return { data, usedNamespace: candidate }
    } catch (e) {
      lastErr = e
      const invalidNs = e?.status === 400 && String(e?.data?.['error-code'] || e?.data?.message || '').toLowerCase().includes('namespace')
      if (!invalidNs) throw e
    }
  }

  throw lastErr || new Error('Namespace code is invalid for all fallback variants.')
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

function collectLeafPaths(node, prefix = '', out = []) {
  if (!isObject(node)) return out

  const properties = isObject(node.properties) ? node.properties : null
  if (!properties) return out

  for (const [key, def] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    const type = inferType(def)

    if (type === 'object' && isObject(def?.properties)) {
      collectLeafPaths(def, path, out)
      continue
    }

    out.push(path)
  }

  return out
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

function defaultFields() {
  return ['_novo.novoMedlinkId', '_novo.email', '_novo.testProfileId', '_novo.name', '_novo.status', '_novo.channel', '_novo.tags']
}

function uniq(items = []) {
  return Array.from(new Set(items.filter(Boolean)))
}

async function resolveFieldsFromSchema({ params, token, apiKey, imsOrg, sandboxName }) {
  const schemaId = String(params.schemaId || params.AEP_XDM_SCHEMA_ID || '').trim()
  if (!schemaId) return null

  const tenantNamespace = String(params.AIO_TENANT_NAMESPACE || '').trim()
  const registryBase = String(params.AEP_SCHEMA_REGISTRY_BASE || 'https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas').replace(/\/$/, '')
  const headers = {
    Authorization: token,
    'x-api-key': apiKey,
    'x-gw-ims-org-id': imsOrg,
    'x-sandbox-name': sandboxName,
    accept: 'application/vnd.adobe.xed-full+json; version=1'
  }

  const candidates = buildSchemaCandidates(schemaId, tenantNamespace)
  const { schemaPayload } = await fetchSchemaWithFallback({ candidates, registryBase, headers })
  const novoNodes = findNovoNodes(schemaPayload)

  const leafPaths = []
  for (const node of novoNodes) collectLeafPaths(node, '', leafPaths)

  const normalized = uniq(leafPaths.map((p) => `_novo.${p}`))
  return normalized.length ? normalized : null
}

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') return corsPreflight()

  try {
    const { token, imsOrg } = requireIms(params)

    const apiKey = String(params.AEP_API_KEY || params.CLIENT_ID || '').trim()
    const sandboxName = String(params.AEP_SANDBOX_NAME || params.SANDBOX_NAME || '').trim()
    if (!apiKey) return badRequest('Missing AEP_API_KEY (or CLIENT_ID input).')
    if (!sandboxName) return badRequest('Missing AEP_SANDBOX_NAME (or SANDBOX_NAME input).')

    const identities = toIdentityObjects(params)
    if (!identities.length) {
      return badRequest('Provide identities[] or emails[] or entityId+entityIdNS for direct profile lookup.')
    }

    const explicitFields = Array.isArray(params.fields) && params.fields.length ? params.fields : null
    let schemaFields = null
    if (!explicitFields) {
      try {
        schemaFields = await resolveFieldsFromSchema({ params, token, apiKey, imsOrg, sandboxName })
      } catch (schemaErr) {
        schemaFields = null
      }
    }

    const fields = uniq([...(explicitFields || []), ...(schemaFields || []), ...defaultFields()])

    const url = 'https://platform.adobe.io/data/core/ups/access/entities'

    let data
    let usedNamespace = null
    try {
      const res = await fetchWithNamespaceFallback({
        url,
        token,
        apiKey,
        imsOrg,
        sandboxName,
        identities,
        fields
      })
      data = res.data
      usedNamespace = res.usedNamespace
    } catch (e) {
      if (e?.status === 404 || isInvalidNamespaceError(e)) {
        return ok({
          count: 0,
          items: [],
          namespaceUsed: null,
          fieldsResolvedFromSchema: Boolean(schemaFields),
          fieldCount: fields.length,
          note: isInvalidNamespaceError(e)
            ? 'Identity namespace is invalid in this sandbox/org. Returned no rows so caller can fallback.'
            : 'No matching entities in Real-Time Profile for supplied identities.'
        })
      }
      throw e
    }

    const entities = Object.values(data || {}).map(normalizeEntity).filter((x) => x.profileId || x.email || x.novoMedlinkId)

    return ok({
      count: entities.length,
      items: entities,
      namespaceUsed: usedNamespace,
      fieldsResolvedFromSchema: Boolean(schemaFields),
      fieldCount: fields.length,
      note: 'Direct Profile Access API read (schema-driven fields when schemaId is provided).'
    })
  } catch (e) {
    return serverError(e.message, { status: e.status, url: e.url, responseText: e.responseText, data: e.data })
  }
}

exports.main = main






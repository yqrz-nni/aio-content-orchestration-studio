const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { requireIms } = require('../../../_lib/ims')
const { fetchJson } = require('../../../_lib/fetchJson')

function getTenantNamespace(params) {
  const explicitNs = String(params?.AIO_TENANT_NAMESPACE || '').trim().replace(/^_/, '')
  if (explicitNs) return explicitNs

  const schemaId = String(params?.AEP_XDM_SCHEMA_ID || '').trim()
  const m = schemaId.match(/^https:\/\/ns\.adobe\.com\/([^\/]+)\/schemas\//i)
  return m && m[1] ? String(m[1]).replace(/^_/, '') : ''
}
function resolveNamespaceCode(code, params) {
  const raw = String(code || '').trim()
  const tenantNs = getTenantNamespace(params)

  if (raw === '__tenant__') return tenantNs || raw
  // Backward compatibility: older UI sent attribute name as namespace.
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

    const fields = Array.isArray(params.fields) && params.fields.length
      ? params.fields
      : ['_novo.novoMedlinkId', '_novo.email', '_novo.testProfileId', '_novo.name', '_novo.status', '_novo.channel', '_novo.tags']

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
      if (e?.status === 404) {
        return ok({
          count: 0,
          items: [],
          note: 'No matching entities in Real-Time Profile for supplied identities.'
        })
      }
      throw e
    }

    const entities = Object.values(data || {}).map(normalizeEntity).filter((x) => x.profileId || x.email || x.novoMedlinkId)

    return ok({
      count: entities.length,
      items: entities,
      namespaceUsed: usedNamespace,
      note: 'Direct Profile Access API read (no Query Service).'
    })
  } catch (e) {
    return serverError(e.message, { status: e.status, url: e.url, responseText: e.responseText, data: e.data })
  }
}

exports.main = main




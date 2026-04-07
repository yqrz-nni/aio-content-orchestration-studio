const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { fetchRaw } = require('../../../_lib/fetchRaw')

function buildIdentityObject(entityIdNS, entityId, tenantNs) {
  const ns = String(entityIdNS || '').trim()
  const id = String(entityId || '').trim()
  if (!ns || !id) return null

  if (ns === 'Email') return { email: id.toLowerCase() }
  if (ns === 'testProfileId') return { testProfileId: id }

  // Namespace and attribute are different concepts:
  // namespace can be tenant code (e.g. novo), attribute remains novoMedlinkId.
  if (ns === '__tenant__' || ns === 'novoMedlinkId' || (tenantNs && ns === tenantNs)) {
    return { novoMedlinkId: id }
  }

  return { [ns]: id }
}

function buildEntity({ identityNs, identityValue, attributes, tenantNs }) {
  const identityPatch = buildIdentityObject(identityNs, identityValue, tenantNs)
  if (!identityPatch) throw new Error('Missing identityNs or identityValue.')

  const attrObj = attributes && typeof attributes === 'object' ? attributes : {}

  // For profile-lab managed schemas, custom fields live under _novo.
  const novoIncoming = attrObj._novo && typeof attrObj._novo === 'object' ? attrObj._novo : attrObj

  return {
    _id: `plab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    _novo: {
      ...identityPatch,
      ...novoIncoming
    }
  }
}

function buildSchemaRef(schemaId) {
  return {
    id: schemaId,
    contentType: 'application/vnd.adobe.xed+json;version=1'
  }
}

function buildPayload({ schemaId, datasetId, entity, orgId }) {
  const schemaRef = buildSchemaRef(schemaId)
  const body = {
    xdmMeta: { schemaRef },
    xdmEntity: entity
  }
  if (datasetId) body.xdmMeta.datasetId = datasetId

  // HTTP API Source-compatible envelope for streaming inlet.
  const header = { schemaRef }
  if (datasetId) header.datasetId = datasetId
  if (orgId) header.imsOrgId = orgId

  return { header, body }
}

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') return corsPreflight()

  try {
    const connectionId = String(params.AEP_STREAMING_CONNECTION_ID || '').trim()
    const schemaId = String(params.AEP_XDM_SCHEMA_ID || '').trim()
    const datasetId = String(params.AEP_PROFILE_DATASET_ID || '').trim()
    const tenantNs = String(params.AIO_TENANT_NAMESPACE || '').trim().replace(/^_/, '')
    const orgId = String(params.ORG_ID || '').trim()

    if (!connectionId) return badRequest('Missing AEP_STREAMING_CONNECTION_ID.')
    if (!schemaId) return badRequest('Missing AEP_XDM_SCHEMA_ID.')

    const identityNs = String(params.identityNs || '').trim()
    const identityValue = String(params.identityValue || '').trim()

    if (!identityNs || !identityValue) {
      return badRequest('Missing identityNs or identityValue.')
    }

    const attributes = params.attributes
    if (!attributes || typeof attributes !== 'object') {
      return badRequest('Missing attributes object. Provide JSON object of fields to update.')
    }

    const entity = buildEntity({
      identityNs,
      identityValue,
      attributes,
      tenantNs
    })

    const payload = buildPayload({ schemaId, datasetId, entity, orgId })

    const base = String(params.AEP_STREAMING_INGEST_BASE || 'https://dcs.adobedc.net').replace(/\/$/, '')
    const syncValidation = params.syncValidation === true || String(params.syncValidation || '').toLowerCase() === 'true'
    const url = `${base}/collection/${encodeURIComponent(connectionId)}?syncValidation=${syncValidation ? 'true' : 'false'}`

    const response = await fetchRaw(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    return ok({
      updated: true,
      ingestion: {
        url,
        status: response.status
      },
      identity: {
        namespace: identityNs,
        value: identityValue
      },
      note: 'Update submitted to streaming ingestion. Profile reflection is asynchronous.'
    })
  } catch (e) {
    return serverError(e.message, {
      status: e.status,
      url: e.url,
      responseText: e.responseText,
      data: e.data
    })
  }
}

exports.main = main

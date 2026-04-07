const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { requireIms } = require('../../../_lib/ims')
const { createAepProfileLabClient } = require('../aepQuery')

function toPositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function isFailureState(state) {
  return ['FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(String(state || '').toUpperCase())
}

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') return corsPreflight()

  try {
    const { token, imsOrg } = requireIms(params)

    const apiKey = String(params.AEP_API_KEY || params.CLIENT_ID || '').trim()
    const sandboxName = String(params.AEP_SANDBOX_NAME || params.SANDBOX_NAME || '').trim()
    const dbName = String(params.AEP_QUERY_DB_NAME || '').trim()
    const snapshotTable = String(params.AEP_PROFILE_LAB_SNAPSHOT_TABLE || params.AEP_PROFILE_LAB_TABLE || '').trim()

    if (!apiKey) return badRequest('Missing AEP_API_KEY (or CLIENT_ID input).')
    if (!sandboxName) return badRequest('Missing AEP_SANDBOX_NAME (or SANDBOX_NAME input).')
    if (!dbName) return badRequest('Missing AEP_QUERY_DB_NAME.')
    if (!snapshotTable) return badRequest('Missing AEP_PROFILE_LAB_SNAPSHOT_TABLE (or AEP_PROFILE_LAB_TABLE).')

    const op = String(params.op || 'start').trim().toLowerCase()
    const queryId = String(params.queryId || '').trim()
    const limit = toPositiveInt(params.limit, 200)

    const client = createAepProfileLabClient({
      token,
      imsOrg,
      apiKey,
      sandboxName,
      apiBaseUrl: String(params.AEP_QUERY_API_BASE || 'https://platform.adobe.io/data/foundation/query').trim()
    })

    if (op === 'start') {
      const sql = client.buildListSql({ table: snapshotTable, search: params.search || '', limit })
      const started = await client.startQuery({
        dbName,
        sql,
        queryName: String(params.AEP_PROFILE_LAB_LIST_QUERY_NAME || 'Profile Lab Snapshot Read').trim(),
        description: 'Read Profile Lab snapshot table for UI list.'
      })

      if (!started.queryId) return serverError('Snapshot read query submission did not return an id.')

      return ok({ op, queryId: started.queryId, state: started.state || 'SUBMITTED', ready: false, count: 0, items: [] })
    }

    if (!queryId) {
      return ok({ op, queryId: null, state: 'IDLE', ready: false, requiresRefresh: true, count: 0, items: [] })
    }

    if (op === 'status') {
      const status = await client.getQueryState(queryId)
      const state = String(status?.state || 'UNKNOWN').toUpperCase()
      return ok({ op, queryId, state, ready: state === 'SUCCESS', failed: isFailureState(state) })
    }

    const result = await client.getQueryResult(queryId)
    return ok({
      op,
      queryId,
      runId: result.runId || null,
      state: result.state || 'UNKNOWN',
      ready: !!result.ready,
      failed: isFailureState(result.state),
      count: Array.isArray(result.items) ? result.items.length : 0,
      items: Array.isArray(result.items) ? result.items : []
    })
  } catch (e) {
    return serverError(e.message, { status: e.status, url: e.url, responseText: e.responseText, data: e.data })
  }
}

exports.main = main

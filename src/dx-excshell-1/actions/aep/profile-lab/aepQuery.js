const { fetchJson } = require('../../_lib/fetchJson')
const { fetchRaw } = require('../../_lib/fetchRaw')

function toPositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function isSafeIdentifier(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || '').trim())
}

function requireSafeIdentifier(name, label) {
  const v = String(name || '').trim()
  if (!isSafeIdentifier(v)) {
    throw new Error(`Invalid ${label}: ${name}. Use letters, numbers, underscore; must not start with a number.`)
  }
  return v
}

function buildListSql({ table, search, limit }) {
  const safeTable = requireSafeIdentifier(table, 'table')
  const q = String(search || '').trim().toLowerCase()
  const safeLimit = Math.max(1, Math.min(toPositiveInt(limit, 100), 500))

  const filters = []
  if (q) {
    const escaped = q.replace(/'/g, "''")
    filters.push(`LOWER(COALESCE(_novo.novoMedlinkId, '')) LIKE '%${escaped}%'`)
    filters.push(`LOWER(COALESCE(_novo.email, '')) LIKE '%${escaped}%'`)
    filters.push(`LOWER(COALESCE(_novo.testProfileId, '')) LIKE '%${escaped}%'`)
    filters.push(`LOWER(COALESCE(_novo.name, '')) LIKE '%${escaped}%'`)
    filters.push(`LOWER(COALESCE(_novo.status, '')) LIKE '%${escaped}%'`)
    filters.push(`LOWER(COALESCE(_novo.channel, '')) LIKE '%${escaped}%'`)
  }

  const whereClause = filters.length ? ` WHERE (${filters.join(' OR ')})` : ''

  return `SELECT _novo.novoMedlinkId AS medlink_id, _novo.email AS email, _novo.testProfileId AS test_profile_id, _novo.name AS name, _novo.status AS status, _novo.channel AS channel, _novo.tags AS tags FROM ${safeTable}${whereClause} LIMIT ${safeLimit};`
}

function buildSnapshotRefreshSql({ sourceTable, snapshotTable, limit }) {
  const safeSource = requireSafeIdentifier(sourceTable, 'sourceTable')
  const safeSnapshot = requireSafeIdentifier(snapshotTable, 'snapshotTable')
  const safeLimit = Math.max(1, Math.min(toPositiveInt(limit, 1000), 5000))

  return `CREATE OR REPLACE TABLE ${safeSnapshot} AS SELECT _novo.novoMedlinkId AS medlink_id, _novo.email AS email, _novo.testProfileId AS test_profile_id, _novo.name AS name, _novo.status AS status, _novo.channel AS channel, _novo.tags AS tags FROM ${safeSource} LIMIT ${safeLimit};`
}

function buildHeaders({ token, imsOrg, apiKey, sandboxName }) {
  return {
    Authorization: token,
    'x-gw-ims-org-id': imsOrg,
    'x-api-key': apiKey,
    'x-sandbox-name': sandboxName,
    'content-type': 'application/json'
  }
}

async function submitQuery({ apiBaseUrl, headers, dbName, sql, queryName, description }) {
  return fetchJson(`${apiBaseUrl}/queries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dbName, sql, name: queryName, description })
  })
}

async function getQueryById({ apiBaseUrl, headers, queryId }) {
  return fetchJson(`${apiBaseUrl}/queries/${encodeURIComponent(queryId)}`, {
    method: 'GET',
    headers
  })
}

function extractRows(data) {
  if (!data) return null
  const rows = data?.rows || data?.result?.rows || data?.results?.rows || data?.data?.rows || (Array.isArray(data) ? data : null)
  return Array.isArray(rows) ? rows : null
}

async function getRowsFromUrl(url, headers) {
  try {
    const raw = await fetchRaw(url, { method: 'GET', headers })
    return extractRows(raw?.data)
  } catch {
    return null
  }
}

async function getJsonMaybe(url, headers) {
  try {
    return await fetchJson(url, { method: 'GET', headers })
  } catch {
    return null
  }
}

function buildDirectResultCandidates(apiBaseUrl, queryId) {
  return [
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/results`,
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/result`,
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/result/0`,
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/data`
  ]
}

function buildRunCandidates(apiBaseUrl, queryId, runId) {
  return [
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/runs/${encodeURIComponent(runId)}/results`,
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/runs/${encodeURIComponent(runId)}/result`,
    `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/runs/${encodeURIComponent(runId)}/data`,
    `${apiBaseUrl}/runs/${encodeURIComponent(runId)}/results`,
    `${apiBaseUrl}/runs/${encodeURIComponent(runId)}/result`,
    `${apiBaseUrl}/runs/${encodeURIComponent(runId)}/data`
  ]
}

function parseRuns(payload) {
  if (Array.isArray(payload?.runs)) return payload.runs
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload)) return payload
  return []
}

function toTs(v) {
  return Date.parse(v || 0) || 0
}

async function fetchRowsForQuery({ apiBaseUrl, headers, queryId }) {
  const attempted = []

  for (const url of buildDirectResultCandidates(apiBaseUrl, queryId)) {
    attempted.push(url)
    const rows = await getRowsFromUrl(url, headers)
    if (Array.isArray(rows)) return { rows, attempted, runId: null }
  }

  const runsUrl = `${apiBaseUrl}/queries/${encodeURIComponent(queryId)}/runs`
  attempted.push(runsUrl)
  const runs = parseRuns(await getJsonMaybe(runsUrl, headers))
    .filter((r) => String(r?.state || '').toUpperCase() === 'SUCCESS')
    .sort((a, b) => toTs(b?.updated || b?.created) - toTs(a?.updated || a?.created))

  for (const run of runs) {
    const runId = run?.id || run?.runId
    if (!runId) continue
    for (const url of buildRunCandidates(apiBaseUrl, queryId, runId)) {
      attempted.push(url)
      const rows = await getRowsFromUrl(url, headers)
      if (Array.isArray(rows)) return { rows, attempted, runId }
    }
  }

  return { rows: null, attempted, runId: null }
}

function normalizeRow(raw) {
  const row = raw || {}
  return {
    profileId: row.test_profile_id || row.medlink_id || null,
    testProfileId: row.test_profile_id || null,
    novoMedlinkId: row.medlink_id || null,
    email: row.email || null,
    name: row.name || null,
    status: row.status || null,
    channel: row.channel || null,
    tags: Array.isArray(row.tags) ? row.tags : typeof row.tags === 'string' ? row.tags.split(',').map((v) => v.trim()).filter(Boolean) : []
  }
}

function createAepProfileLabClient({ token, imsOrg, apiKey, sandboxName, apiBaseUrl = 'https://platform.adobe.io/data/foundation/query' }) {
  const headers = buildHeaders({ token, imsOrg, apiKey, sandboxName })

  return {
    buildListSql,
    buildSnapshotRefreshSql,

    async startQuery({ dbName, sql, queryName, description }) {
      const created = await submitQuery({ apiBaseUrl, headers, dbName, sql, queryName, description })
      return { queryId: created?.id || null, state: created?.state || null, sql }
    },

    async getQueryState(queryId) {
      return getQueryById({ apiBaseUrl, headers, queryId })
    },

    async getQueryResult(queryId) {
      const status = await getQueryById({ apiBaseUrl, headers, queryId })
      const state = String(status?.state || '').toUpperCase()
      if (state !== 'SUCCESS') return { state, ready: false, items: [] }

      const { rows, attempted, runId } = await fetchRowsForQuery({ apiBaseUrl, headers, queryId })
      if (!Array.isArray(rows)) {
        throw new Error(`Query ${queryId} succeeded but no row payload was returned. Endpoints tried: ${attempted.slice(0, 8).join(' | ')}`)
      }

      return { state, ready: true, queryId, runId, items: rows.map(normalizeRow) }
    }
  }
}

module.exports = {
  createAepProfileLabClient
}

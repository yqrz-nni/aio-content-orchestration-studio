const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const {
  getStateClient,
  getCatalog,
  saveCatalog,
  isValidKey,
  normalizeKey,
  upsertCatalogEntry
} = require('../_lib/stateAdmin')

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') {
    return corsPreflight()
  }

  try {
    const key = normalizeKey(params.key)
    if (!isValidKey(key)) {
      return badRequest('Invalid key. Use only a-z, A-Z, 0-9, dash, underscore, dot.')
    }

    if (params.value === undefined) {
      return badRequest('Missing value payload.')
    }

    const state = await getStateClient()
    const payload = typeof params.value === 'string' ? params.value : JSON.stringify(params.value)
    await state.put(key, payload, { ttl: 60 * 60 * 24 * 365 })

    const catalog = await getCatalog(state)
    const nextCatalog = upsertCatalogEntry(catalog, {
      key,
      updatedAt: new Date().toISOString(),
      size: String(payload).length
    })
    await saveCatalog(state, nextCatalog)

    return ok({ ok: true, key, size: String(payload).length })
  } catch (e) {
    return serverError(e.message, { stack: e.stack })
  }
}

exports.main = main

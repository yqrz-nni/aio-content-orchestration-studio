const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const {
  getStateClient,
  getCatalog,
  saveCatalog,
  isValidKey,
  normalizeKey,
  removeCatalogEntry
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

    const state = await getStateClient()
    if (typeof state.delete === 'function') {
      await state.delete(key)
    } else {
      return badRequest('Delete is not available in this aio-lib-state runtime.')
    }

    const catalog = await getCatalog(state)
    const nextCatalog = removeCatalogEntry(catalog, key)
    await saveCatalog(state, nextCatalog)

    return ok({ ok: true, key, deleted: true })
  } catch (e) {
    return serverError(e.message, { stack: e.stack })
  }
}

exports.main = main

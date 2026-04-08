const { ok, serverError, corsPreflight } = require('../../../_lib/http')
const { getStateClient, getCatalog, CATALOG_KEY } = require('../_lib/stateAdmin')

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') {
    return corsPreflight()
  }

  try {
    const state = await getStateClient()
    const catalog = await getCatalog(state)

    return ok({
      ok: true,
      catalogKey: CATALOG_KEY,
      count: catalog.length,
      items: catalog
    })
  } catch (e) {
    return serverError(e.message, { stack: e.stack })
  }
}

exports.main = main

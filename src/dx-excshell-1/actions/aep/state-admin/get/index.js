const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { getStateClient, isValidKey, normalizeKey, safeParseJson } = require('../_lib/stateAdmin')

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
    const doc = await state.get(key)
    const raw = doc?.value || null
    const json = raw ? safeParseJson(raw, null) : null

    return ok({
      ok: true,
      key,
      exists: Boolean(raw),
      value: json !== null ? json : raw,
      isJson: json !== null
    })
  } catch (e) {
    return serverError(e.message, { stack: e.stack })
  }
}

exports.main = main

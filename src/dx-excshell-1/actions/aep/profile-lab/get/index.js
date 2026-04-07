const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { getProfile } = require('../_store')

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') {
    return corsPreflight()
  }

  try {
    const profileId = String(params.profileId || '').trim()
    if (!profileId) {
      return badRequest('Missing profileId (string).')
    }

    const item = getProfile(profileId)
    if (!item) {
      return badRequest(`Profile not found: ${profileId}`)
    }

    return ok({ item })
  } catch (e) {
    return serverError(e.message)
  }
}

exports.main = main


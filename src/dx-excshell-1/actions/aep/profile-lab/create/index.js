const { ok, badRequest, serverError, corsPreflight } = require('../../../_lib/http')
const { createProfile } = require('../_store')

async function main(params) {
  if ((params.__ow_method || '').toUpperCase() === 'OPTIONS') {
    return corsPreflight()
  }

  try {
    const profileId = String(params.profileId || '').trim()
    const name = String(params.name || '').trim()

    if (!profileId) return badRequest('Missing profileId (string).')
    if (!name) return badRequest('Missing name (string).')

    const item = createProfile({
      profileId,
      name,
      channel: params.channel,
      description: params.description,
      tags: params.tags
    })

    return ok({ item, created: true })
  } catch (e) {
    if (e.message && e.message.startsWith('Profile already exists')) {
      return badRequest(e.message)
    }
    return serverError(e.message)
  }
}

exports.main = main


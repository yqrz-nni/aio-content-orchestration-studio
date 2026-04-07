const seedProfiles = [
  {
    profileId: 'checkout-smoke',
    name: 'Checkout Smoke Test',
    channel: 'Email',
    description: 'Baseline smoke test profile for checkout messaging.',
    tags: ['smoke', 'checkout'],
    createdAt: '2026-04-04T12:00:00.000Z',
    updatedAt: '2026-04-04T12:00:00.000Z'
  },
  {
    profileId: 'welcome-regression',
    name: 'Welcome Regression',
    channel: 'Push',
    description: 'Regression profile for welcome journey validation.',
    tags: ['regression', 'welcome'],
    createdAt: '2026-04-02T12:00:00.000Z',
    updatedAt: '2026-04-02T12:00:00.000Z'
  },
  {
    profileId: 'profile-merge-validation',
    name: 'Profile Merge Validation',
    channel: 'SMS',
    description: 'Checks merge rules and identity stitching behavior.',
    tags: ['identity', 'validation'],
    createdAt: '2026-03-29T12:00:00.000Z',
    updatedAt: '2026-03-29T12:00:00.000Z'
  }
]

function ensureStore() {
  if (!global.__PROFILE_LAB_STORE__) {
    const map = new Map()
    for (const profile of seedProfiles) {
      map.set(profile.profileId, { ...profile })
    }
    global.__PROFILE_LAB_STORE__ = map
  }
  return global.__PROFILE_LAB_STORE__
}

function nowIso() {
  return new Date().toISOString()
}

function asArray(input) {
  if (Array.isArray(input)) return input
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function listProfiles(searchTerm) {
  const store = ensureStore()
  let profiles = Array.from(store.values())

  if (searchTerm) {
    const term = String(searchTerm).toLowerCase()
    profiles = profiles.filter((p) => {
      return (
        p.profileId.toLowerCase().includes(term) ||
        p.name.toLowerCase().includes(term) ||
        String(p.channel || '').toLowerCase().includes(term)
      )
    })
  }

  profiles.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return profiles
}

function getProfile(profileId) {
  const store = ensureStore()
  return store.get(profileId) || null
}

function createProfile(input) {
  const store = ensureStore()
  const profileId = String(input.profileId || '').trim()
  const name = String(input.name || '').trim()

  if (!profileId) throw new Error('Missing profileId (string).')
  if (!name) throw new Error('Missing name (string).')
  if (store.has(profileId)) throw new Error(`Profile already exists: ${profileId}`)

  const timestamp = nowIso()
  const profile = {
    profileId,
    name,
    channel: String(input.channel || 'Email').trim() || 'Email',
    description: String(input.description || '').trim() || null,
    tags: asArray(input.tags),
    createdAt: timestamp,
    updatedAt: timestamp
  }

  store.set(profileId, profile)
  return profile
}

function updateProfile(profileId, patch) {
  const store = ensureStore()
  const current = store.get(profileId)
  if (!current) return null

  const next = {
    ...current,
    name: patch.name !== undefined ? String(patch.name || '').trim() || current.name : current.name,
    channel: patch.channel !== undefined ? String(patch.channel || '').trim() || current.channel : current.channel,
    description: patch.description !== undefined ? String(patch.description || '').trim() || null : current.description,
    tags: patch.tags !== undefined ? asArray(patch.tags) : current.tags,
    updatedAt: nowIso()
  }

  store.set(profileId, next)
  return next
}

module.exports = {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile
}

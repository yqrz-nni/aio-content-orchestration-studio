const { init } = require('@adobe/aio-lib-state')

const CATALOG_KEY = 'profile-lab.state-admin.catalog.v1'
const VALID_KEY_RE = /^[a-zA-Z0-9-_.]{1,1024}$/

function isValidKey(key) {
  return VALID_KEY_RE.test(String(key || '').trim())
}

function normalizeKey(key) {
  return String(key || '').trim()
}

function safeParseJson(raw, fallback) {
  try {
    return JSON.parse(raw)
  } catch (e) {
    return fallback
  }
}

async function getStateClient() {
  return init()
}

async function getCatalog(state) {
  const doc = await state.get(CATALOG_KEY)
  const parsed = doc?.value ? safeParseJson(doc.value, null) : null
  if (Array.isArray(parsed)) {
    return parsed.filter((x) => isValidKey(x?.key)).map((x) => ({
      key: normalizeKey(x.key),
      updatedAt: String(x.updatedAt || ''),
      size: Number(x.size || 0)
    }))
  }
  return []
}

async function saveCatalog(state, items) {
  await state.put(CATALOG_KEY, JSON.stringify(items), { ttl: 60 * 60 * 24 * 365 })
}

function upsertCatalogEntry(catalog, entry) {
  const key = normalizeKey(entry.key)
  const next = catalog.filter((x) => normalizeKey(x.key) !== key)
  next.push({ key, updatedAt: entry.updatedAt, size: Number(entry.size || 0) })
  next.sort((a, b) => String(a.key).localeCompare(String(b.key)))
  return next
}

function removeCatalogEntry(catalog, key) {
  const normalized = normalizeKey(key)
  return catalog.filter((x) => normalizeKey(x.key) !== normalized)
}

module.exports = {
  CATALOG_KEY,
  isValidKey,
  normalizeKey,
  safeParseJson,
  getStateClient,
  getCatalog,
  saveCatalog,
  upsertCatalogEntry,
  removeCatalogEntry
}

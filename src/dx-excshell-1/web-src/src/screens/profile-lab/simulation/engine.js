function toNumber(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v))
}

function recencyScore(dateStr) {
  if (!dateStr) return 0
  const t = Date.parse(dateStr)
  if (!Number.isFinite(t)) return 0
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24)
  if (days <= 7) return 1
  if (days <= 30) return 0.7
  if (days <= 90) return 0.4
  return 0.1
}

function ratioDirection(current, previous) {
  const a = toNumber(current, 0)
  const b = toNumber(previous, 0)
  const base = Math.max(Math.abs(b), 1)
  const diff = (a - b) / base
  if (diff > 0.1) return 'increasing'
  if (diff < -0.1) return 'decreasing'
  return 'stable'
}

function stateFromSeries(v30, v60, v90) {
  const values = [toNumber(v30, 0), toNumber(v60, 0), toNumber(v90, 0)]
  const max = Math.max(...values, 1)
  const recentRatio = values[0] / max
  if (recentRatio >= 0.66) return 'high'
  if (recentRatio >= 0.33) return 'moderate'
  return 'low'
}

function computeContentAffinity(demoData = {}) {
  const nml = demoData.nmlActivity || {}
  const weeks = [nml.activity1Week || {}, nml.activity2Weeks || {}, nml.activity3Weeks || {}, nml.activity4Weeks || {}]

  const boolHits = (key) => weeks.filter((w) => w?.[key] === true).length
  const sessions = weeks.reduce((sum, w) => sum + toNumber(w?.numberOfSessions, 0), 0)

  const email30 = toNumber(demoData?.emailActivity?.emailsReceived30Days, 0)
  const sms30 = toNumber(demoData?.smsActivity?.smsReceived30Days, 0)
  const recentWeb = recencyScore(nml.lastWebsiteVisit)

  const wegovy30 = toNumber(demoData?.samplesHistory?.wegovy?.requests30Days, 0)
  const ozempic30 = toNumber(demoData?.samplesHistory?.ozempic?.requests30Days, 0)

  const contentAffinity = {
    updates: clamp((recentWeb + clamp(email30 / 12) + clamp(sms30 / 12)) / 3),
    samples: clamp((wegovy30 + ozempic30 + boolHits('requestSamples') * 2) / 3, 0, 10),
    professionalEducation: clamp((boolHits('professionalEducation') + clamp(sessions / 8)) / 2),
    patientSupport: clamp((boolHits('patientSupport') + boolHits('patientSavings')) / 4),
    dosing: clamp((boolHits('obesity') + boolHits('diabetes') + clamp(sessions / 10)) / 3),
    safety: clamp((boolHits('rareDisease') + clamp(email30 / 20)) / 2),
    affordability: clamp((boolHits('patientSavings') + clamp(email30 / 15)) / 2),
    formulary: clamp((boolHits('requestSamples') + clamp(sms30 / 15)) / 2),
    efficacy: clamp((clamp(sessions / 12) + recentWeb) / 2)
  }

  const affinityValues = [
    contentAffinity.updates,
    contentAffinity.professionalEducation,
    contentAffinity.patientSupport,
    contentAffinity.dosing,
    contentAffinity.safety,
    contentAffinity.affordability,
    contentAffinity.formulary,
    contentAffinity.efficacy
  ]
  const portfolioAffinity = clamp(affinityValues.reduce((a, b) => a + b, 0) / affinityValues.length)

  return { contentAffinity, portfolioAffinity }
}

function computeEngagementState(demoData = {}) {
  const nml = demoData.nmlActivity || {}
  const weeks = [nml.activity1Week || {}, nml.activity2Weeks || {}, nml.activity3Weeks || {}, nml.activity4Weeks || {}]
  const sessions = weeks.reduce((sum, w) => sum + toNumber(w?.numberOfSessions, 0), 0)

  const email30 = toNumber(demoData?.emailActivity?.emailsReceived30Days, 0)
  const sms30 = toNumber(demoData?.smsActivity?.smsReceived30Days, 0)
  const webScore = recencyScore(nml.lastWebsiteVisit)
  const repScore = recencyScore(demoData?.fieldActivity?.lastRepVisit)

  const signal = sessions + (email30 / 3) + (sms30 / 3) + (webScore * 5) + (repScore * 4)

  let ownedChannels = 'dormant'
  if (signal >= 22) ownedChannels = 'highFrequency'
  else if (signal >= 12) ownedChannels = 'active'
  else if (signal >= 6) ownedChannels = 'reengaged'
  else if (signal >= 2) ownedChannels = 'new'
  else if (signal > 0) ownedChannels = 'lapsed'

  return { ownedChannels }
}

function computeBrandScores(demoData = {}) {
  const brandSignals = Array.isArray(demoData?.brandSignals) ? demoData.brandSignals : []

  return brandSignals.map((signal) => {
    const brandId = String(signal?.brandId || '').trim() || 'unknown-brand'

    const rx = signal?.rxMetrics || {}

    return {
      brandId,
      nbrxDirection: ratioDirection(rx?.nbrxDecile30Days, rx?.nbrxDecile60Days),
      rbrxDirection: ratioDirection(rx?.rbrxDecile30Days, rx?.rbrxDecile60Days),
      trxDirection: ratioDirection(rx?.trxDecile30Days, rx?.trxDecile60Days),
      nbrxState: stateFromSeries(rx?.nbrxDecile30Days, rx?.nbrxDecile60Days, rx?.nbrxDecile90Days),
      rbrxState: stateFromSeries(rx?.rbrxDecile30Days, rx?.rbrxDecile60Days, rx?.rbrxDecile90Days),
      trxState: stateFromSeries(rx?.trxDecile30Days, rx?.trxDecile60Days, rx?.trxDecile90Days)
    }
  })
}

export function computeDerivedSignals(novo = {}) {
  const demoData = novo?.hcpDemo?.demoData || {}

  const { contentAffinity, portfolioAffinity } = computeContentAffinity(demoData)
  const engagementState = computeEngagementState(demoData)
  const brandScores = computeBrandScores(demoData)

  const derivedPatch = {
    hcpDemo: {
      demoData: {
        scores: {
          contentAffinity,
          portfolioAffinity,
          engagementState,
          brandScores
        }
      }
    }
  }

  const explanations = [
    `Content affinity is recalculated from recent web/email/sms activity and topic interactions across weekly NML activity.`,
    `Engagement state reflects aggregate signal strength from sessions, owned-channel touchpoints, and recency.`,
    `Brand scores are inferred per brand from 30/60/90-day brandSignals rxMetrics trends.`
  ]

  return {
    derivedPatch,
    preview: {
      contentAffinity,
      portfolioAffinity,
      engagementState,
      brandScores
    },
    explanations
  }
}

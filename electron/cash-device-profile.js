function hardwareProfile(property, building, env = {}) {
  const profile = env.KIOSK_HARDWARE || (property === 'property4' ? 'camp'
    : property === 'property3' && building === 'B' ? 'beach-b' : 'oneplus')
  if (!['oneplus', 'camp', 'beach-b'].includes(profile) || profile === 'camp' && !['property3', 'property4'].includes(property)) return null
  return profile
}

function usesIntegratedCash(property, building, env = {}) {
  return ['camp', 'beach-b'].includes(hardwareProfile(property, building, env))
}

function cashBackend(property, building, env = {}) {
  return { 'beach-b': 'multi3400', camp: 'bac2400', oneplus: 'oneplus' }[hardwareProfile(property, building, env)] || null
}

function cashPayoutUnit(property, building, env = {}) {
  if (cashBackend(property, building, env) !== 'multi3400') return 10000
  const value = env.MULTI3400_BD1_VALUE === undefined ? 5000 : Number(env.MULTI3400_BD1_VALUE)
  // Keep a usable display unit; the board independently refuses an invalid configured value.
  return [1000, 5000, 10000, 50000].includes(value) ? value : 5000
}

module.exports = { hardwareProfile, usesIntegratedCash, cashBackend, cashPayoutUnit }

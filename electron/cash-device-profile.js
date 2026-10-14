function usesIntegratedCash(property, building) {
  return property === 'property4' || property === 'property3' && building === 'B'
}

function cashBackend(property, building) {
  return property === 'property3' && building === 'B' ? 'multi3400' : property === 'property4' ? 'bac2400' : 'oneplus'
}

function cashPayoutUnit(property, building, env = {}) {
  if (cashBackend(property, building) !== 'multi3400') return 10000
  const value = env.MULTI3400_BD1_VALUE === undefined ? 5000 : Number(env.MULTI3400_BD1_VALUE)
  // Keep a usable display unit; the board independently refuses an invalid configured value.
  return [1000, 5000, 10000, 50000].includes(value) ? value : 5000
}

module.exports = { usesIntegratedCash, cashBackend, cashPayoutUnit }

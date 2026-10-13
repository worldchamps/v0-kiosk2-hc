function usesIntegratedCash(property, building) {
  return cashBackend(property, building) !== 'oneplus'
}

function cashBackend(property, building) {
  return property === 'property3' && building === 'B' ? 'multi3400' : property === 'property4' ? 'bac2400' : 'oneplus'
}

function cashPayoutValue(property, building, env) {
  if (cashBackend(property, building) !== 'multi3400') return 10000
  const value = Number(env.MULTI3400_BD1_VALUE || '10000')
  return [1000, 5000, 10000, 50000].includes(value) ? value : null
}

module.exports = { usesIntegratedCash, cashBackend, cashPayoutValue }

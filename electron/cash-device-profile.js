function usesIntegratedCash(property, building) {
  return property === 'property4' || property === 'property3' && building === 'B'
}

module.exports = { usesIntegratedCash }

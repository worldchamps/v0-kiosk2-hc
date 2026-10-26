const test = require('node:test')
const assert = require('node:assert/strict')
const { hardwareProfile, cashBackend, cashPayoutUnit, usesIntegratedCash } = require('../electron/cash-device-profile')
const { enabled, scopedRoom, supportsCardKey } = require('../electron/card-key-service')

test('unset hardware retains the three legacy profiles, including Camp and Kariv', () => {
  for (const [property, building, profile, backend] of [
    ['property4', '', 'camp', 'bac2400'], ['property3', 'B', 'beach-b', 'multi3400'],
    ['property3', 'A', 'oneplus', 'oneplus'], ['property1', '', 'oneplus', 'oneplus'],
    ['property1', 'C', 'oneplus', 'oneplus'], ['property1', 'D', 'beach-b', 'multi3400'],
    ['property2', '', 'oneplus', 'oneplus'],
  ]) {
    assert.equal(hardwareProfile(property, building, {}), profile)
    assert.equal(cashBackend(property, building, {}), backend)
  }
})

test('a beach-b machine keeps MULTI3400, integrated cash and 5000-won payout after moving to A', () => {
  const env = { KIOSK_HARDWARE: 'beach-b' }
  assert.equal(hardwareProfile('property3', 'A', env), 'beach-b')
  assert.equal(cashBackend('property3', 'A', env), 'multi3400')
  assert.equal(usesIntegratedCash('property3', 'A', env), true)
  assert.equal(cashPayoutUnit('property3', 'A', env), 5000)
  assert.equal(enabled({ ...env, KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'A', CARD_DISPENSER_ENABLED: 'true' }), false)
})

test('Beach D uses MULTI3400 with 10000-won payout; a pinned ONEPLUS D machine stays ONEPLUS', () => {
  assert.equal(cashPayoutUnit('property1', 'D', {}), 10000)
  assert.equal(cashPayoutUnit('property3', 'B', {}), 5000)
  assert.equal(supportsCardKey('property1', 'D', {}), false)
  assert.equal(hardwareProfile('property1', 'D', { KIOSK_HARDWARE: 'oneplus' }), 'oneplus')
  const { findWoosimPrinter } = require('../electron/sam4s-receipt')
  assert.equal(findWoosimPrinter([{ name: 'Microsoft Print to PDF' }, { name: 'REXOD RMP-8300' }]).name, 'REXOD RMP-8300')
})

test('property3 A/B explicitly use Camp hardware with 10000-won BAC-2400 and no card key', () => {
  const env = { KIOSK_HARDWARE: 'camp', MULTI3400_BD1_VALUE: '5000', CARD_DISPENSER_ENABLED: 'true' }
  for (const building of ['A', 'B']) {
    assert.equal(hardwareProfile('property3', building, env), 'camp')
    assert.equal(cashBackend('property3', building, env), 'bac2400')
    assert.equal(usesIntegratedCash('property3', building, env), true)
    assert.equal(cashPayoutUnit('property3', building, env), 10000)
    assert.equal(supportsCardKey('property3', building, env), false)
    assert.equal(enabled({ ...env, KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: building }), false)
  }
})

test('Camp outside property3/property4 disables devices instead of inferring a replacement', () => {
  const env = { KIOSK_HARDWARE: 'camp' }
  for (const property of ['property1', 'property2']) {
    assert.equal(hardwareProfile(property, 'B', env), null)
    assert.equal(cashBackend(property, 'B', env), null)
    assert.equal(usesIntegratedCash(property, 'B', env), false)
    assert.equal(supportsCardKey(property, 'B', env), false)
  }
  assert.equal(hardwareProfile('property4', '', env), 'camp')
})

test('invalid hardware disables devices instead of inferring a replacement', () => {
  for (const value of ['bad', 'ONEPLUS', ' beach-b ']) {
    const env = { KIOSK_HARDWARE: value }
    assert.equal(hardwareProfile('property3', 'B', env), null)
    assert.equal(cashBackend('property3', 'B', env), null)
    assert.equal(usesIntegratedCash('property3', 'B', env), false)
    assert.equal(enabled({ ...env, KIOSK_PROPERTY_ID: 'property1', CARD_DISPENSER_ENABLED: 'true' }), false)
  }
})

test('ONEPLUS card support follows the machine while room access follows its sales building', () => {
  const env = { KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'B', KIOSK_HARDWARE: 'oneplus', CARD_DISPENSER_ENABLED: 'true' }
  assert.equal(enabled(env), true)
  assert.equal(scopedRoom('B-101', env), 'B101')
  assert.throws(() => scopedRoom('A101', env), /room_out_of_scope/)
  const c = { ...env, KIOSK_PROPERTY_ID: 'property1', KIOSK_BUILDING: 'C' }
  assert.equal(scopedRoom('C105', c), 'C105')
  assert.throws(() => scopedRoom('D213', c), /room_out_of_scope/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { hardwareProfile, cashBackend, cashPayoutUnit, usesIntegratedCash } = require('../electron/cash-device-profile')
const { enabled, scopedRoom } = require('../electron/card-key-service')

test('unset hardware retains the three legacy profiles, including Camp and Kariv', () => {
  for (const [property, building, profile, backend] of [
    ['property4', '', 'camp', 'bac2400'], ['property3', 'B', 'beach-b', 'multi3400'],
    ['property3', 'A', 'oneplus', 'oneplus'], ['property1', '', 'oneplus', 'oneplus'],
    ['property1', 'C', 'oneplus', 'oneplus'], ['property1', 'D', 'oneplus', 'oneplus'],
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

test('invalid hardware and Camp outside property4 disable devices instead of inferring a replacement', () => {
  for (const value of ['bad', 'ONEPLUS', ' beach-b ', 'camp']) {
    const env = { KIOSK_HARDWARE: value }
    assert.equal(hardwareProfile('property3', 'B', env), null)
    assert.equal(cashBackend('property3', 'B', env), null)
    assert.equal(usesIntegratedCash('property3', 'B', env), false)
    assert.equal(enabled({ ...env, KIOSK_PROPERTY_ID: 'property1', CARD_DISPENSER_ENABLED: 'true' }), false)
  }
  assert.equal(hardwareProfile('property4', '', { KIOSK_HARDWARE: 'camp' }), 'camp')
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

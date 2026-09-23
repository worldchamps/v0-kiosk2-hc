const test = require('node:test')
const assert = require('node:assert/strict')
const { view, updatedConfig, createDeviceSettings } = require('../electron/device-settings')

const config = property => ({
  registered: true, property, deviceId: 'field-pc', refreshToken: 'preserve-me',
  env: { KIOSK_PROPERTY_ID: property, KIOSK_BUILDING: 'B', PRIVATE_API_KEY: 'preserve-me',
    TOSS_FRONT_PAIRING_KEY: 'existing-pairing-key' },
})

test('registration view hides pairing key and preserves device identity when saving all property types', () => {
  for (const property of ['property1', 'property2', 'property3', 'property4']) {
    const original = config(property)
    const shown = view(original)
    assert.equal(shown.pairingKeySet, true)
    assert.equal(shown.values.tossPairingKey, '')
    assert.equal(JSON.stringify(shown).includes('existing-pairing-key'), false)
    const values = { ...shown.values, tossTransport: 'serial', tossSerialPath: 'com8',
      tossSerialBaudRate: '115200', tossPairingKey: '' }
    if (property === 'property4') values.bac2400Port = 'com5'
    else Object.assign(values, { printerPort: 'com2', acceptorPort: 'com4', dispenserPort: 'com5' })
    const saved = updatedConfig(original, values)
    assert.equal(saved.deviceId, original.deviceId)
    assert.equal(saved.refreshToken, original.refreshToken)
    assert.equal(saved.env.PRIVATE_API_KEY, original.env.PRIVATE_API_KEY)
    assert.equal(saved.env.TOSS_FRONT_PAIRING_KEY, 'existing-pairing-key')
    assert.equal(saved.env.TOSS_FRONT_SERIAL_PATH, 'COM8')
    if (property === 'property4') assert.equal(saved.env.BAC2400_PORT, 'COM5')
    else if (property === 'property2') assert.equal(saved.env.PRINTER_PATH, undefined)
    else assert.equal(saved.env.PRINTER_PATH, 'COM2')
    assert.deepEqual(original.env, config(property).env)
  }
})

test('rejects duplicate ports, malformed settings and incomplete serial pairing', () => {
  const original = config('property4')
  const valid = { ...view(original).values, tossTransport: 'serial', tossSerialPath: 'COM8' }
  assert.throws(() => updatedConfig(original, { ...valid, bac2400Port: 'com8' }), /동일한 COM/)
  assert.throws(() => updatedConfig(original, { ...valid, tossSerialPath: 'COM0' }), /COM 포트/)
  assert.throws(() => updatedConfig(original, { ...valid, KIOSK_PROPERTY_ID: 'property1' }), /형식/)
  assert.throws(() => updatedConfig(original, { ...valid, tossWsUrl: 'https://other-host' }), /WebSocket|ws:\/\//)
  assert.throws(() => updatedConfig(config('property4'), { ...valid, tossPairingKey: 'short' }), /16~128/)
  assert.throws(() => updatedConfig({ ...original, env: {} }, valid), /페어링 키/)
  assert.throws(() => updatedConfig({ ...original, env: {} }, { ...valid, tossTransport: 'auto' }), /페어링 키/)
})

test('IPC service requires administrator authorization and only writes after validation', async () => {
  let stored = config('property3')
  let writes = 0
  const service = createDeviceSettings({
    enabled: () => true,
    authorize: (_event, password) => password === 'correct' ? { success: true } : { success: false, error: '인증 실패' },
    readConfig: () => stored,
    writeConfig: next => { stored = next; writes++ },
    listPorts: async () => [{ path: 'COM8', manufacturer: 'Adapter' }],
    listPrinters: async () => [{ name: 'SAM4S Printer' }],
  })
  assert.equal((await service.read({}, 'wrong')).success, false)
  assert.equal((await service.read({}, 'correct')).values.tossPairingKey, '')
  assert.equal((await service.read({}, 'correct')).serialPorts[0].path, 'COM8')
  const values = { ...view(stored).values, tossTransport: 'serial', tossSerialPath: 'COM8' }
  assert.equal(service.save({}, { password: 'wrong', values }).success, false)
  assert.equal(service.save({}, { password: 'correct', values: { ...values, printerPort: 'COM8' } }).success, false)
  assert.equal(writes, 0)
  assert.equal(service.save({}, { password: 'correct', values }).success, true)
  assert.equal(writes, 1)
  assert.equal(stored.env.TOSS_FRONT_SERIAL_PATH, 'COM8')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { view, updatedConfig, createDeviceSettings } = require('../electron/device-settings')
const { usesIntegratedCash } = require('../electron/cash-device-profile')

const config = property => ({
  registered: true, property, deviceId: 'field-pc', refreshToken: 'preserve-me',
  env: { KIOSK_PROPERTY_ID: property, KIOSK_BUILDING: property === 'property3' ? 'B' : '', PRIVATE_API_KEY: 'preserve-me',
    TOSS_FRONT_PAIRING_KEY: 'existing-pairing-key' },
})

test('only Camp and property3 B use one configurable cash board port; individual device settings are preserved', () => {
  for (const [property, building, integrated] of [
    ['property1', 'C', false], ['property1', 'B', false], ['property2', 'B', false],
    ['property3', 'A', false], ['property3', '', false], ['property3', 'B', true], ['property4', '', true],
  ]) {
    assert.equal(usesIntegratedCash(property, building), integrated)
    const original = config(property)
    Object.assign(original.env, { KIOSK_BUILDING: building, ACCEPTOR_PORT: 'COM4', DISPENSER_PORT: 'COM6' })
    const input = { ...view(original).values, bac2400Port: 'com9', woosimPrinterName: 'field Woosim', sam4sPrinterName: 'field SAM4S' }
    if (property === 'property1' && building === 'B' || property === 'property3' && building === '') {
      assert.throws(() => updatedConfig(original, input), /판매 동/)
      continue
    }
    const saved = updatedConfig(original, input)
    assert.equal(saved.env.BAC2400_PORT, integrated ? 'COM9' : undefined)
    assert.equal(saved.env.ACCEPTOR_PORT, 'COM4')
    assert.equal(saved.env.DISPENSER_PORT, 'COM6')
    if (property === 'property3' && building === 'B') {
      assert.equal(saved.env.WOOSIM_PRINTER_NAME, 'field Woosim')
      assert.equal(saved.env.SAM4S_PRINTER_NAME, undefined)
      assert.throws(() => updatedConfig(original, { ...input, tossSerialPath: 'COM9' }), /동일한 COM/)
      // Unused old ONEPLUS fields are not active ports in B.
      assert.equal(updatedConfig(original, { ...input, acceptorPort: 'COM9', dispenserPort: 'COM9' }).env.BAC2400_PORT, 'COM9')
    }
  }
})

test('sales building changes freeze inferred hardware before updating scope and start location', () => {
  const original = config('property3')
  original.env.KIOSK_START_LOCATION = 'B'
  const saved = updatedConfig(original, { ...view(original).values, building: 'A', bac2400Port: 'COM9' })
  assert.equal(saved.env.KIOSK_BUILDING, 'A')
  assert.equal(saved.env.KIOSK_HARDWARE, 'beach-b')
  assert.equal(saved.env.BAC2400_PORT, 'COM9')
  assert.equal(saved.env.KIOSK_START_LOCATION, 'A')
  assert.equal(view(saved).hardwareProfile, 'beach-b')
  assert.equal(view(saved).cardKeySupported, false)
  assert.equal(original.env.KIOSK_HARDWARE, undefined)
  assert.equal(original.env.KIOSK_BUILDING, 'B')
  const back = updatedConfig(saved, { ...view(saved).values, building: 'B' })
  assert.equal(back.env.KIOSK_HARDWARE, 'beach-b')
  const oneplus = config('property3'); oneplus.env.KIOSK_BUILDING = 'A'
  const moved = updatedConfig(oneplus, { ...view(oneplus).values, building: 'B' })
  assert.equal(moved.env.KIOSK_HARDWARE, 'oneplus')
  assert.equal(view(moved).cardKeySupported, true)
})

test('only buildings belonging to the registered property can be saved; property cannot be changed', () => {
  for (const [property, allowed, rejected] of [
    ['property3', ['A', 'B'], ['', 'C', 'D', 'a', 'AB']],
    ['property1', ['', 'C', 'D'], ['A', 'B', 'c', 'CD']],
    ['property2', [''], ['A', 'C']], ['property4', [''], ['A', 'C']],
  ]) {
    const original = config(property)
    for (const building of allowed) {
      const saved = updatedConfig(original, { ...view(original).values, building })
      assert.equal(saved.env.KIOSK_BUILDING, building)
      assert.equal(saved.property, property)
      if (building) assert.equal(saved.env.KIOSK_START_LOCATION, building)
    }
    for (const building of rejected) assert.throws(() => updatedConfig(original, { ...view(original).values, building }), /판매 동/)
    assert.throws(() => updatedConfig(original, { ...view(original).values, property: 'property1' }), /형식/)
  }
  const original = config('property1'); original.env.KIOSK_START_LOCATION = 'D'
  const c = updatedConfig(original, { ...view(original).values, building: 'C' })
  assert.equal(c.env.KIOSK_HARDWARE, 'oneplus')
  assert.equal(c.env.KIOSK_START_LOCATION, 'C')
  const all = updatedConfig(c, { ...view(c).values, building: '' })
  assert.equal(all.env.KIOSK_START_LOCATION, 'C')
  assert.equal(all.env.KIOSK_HARDWARE, 'oneplus')
  assert.throws(() => updatedConfig({ ...c, env: { ...c.env, KIOSK_HARDWARE: 'invalid' } }, view(c).values), /KIOSK_HARDWARE/)
})

test('active payment or records block saving; a valid building change writes once and requests restart', () => {
  let idle = false, writes = 0, restarts = 0, stored = config('property3')
  const service = createDeviceSettings({ enabled: () => true, authorize: () => ({ success: true }),
    readConfig: () => stored, writeConfig: next => { stored = next; writes++ },
    isIdle: () => idle, restart: () => { restarts++ } })
  const input = { password: 'correct', values: { ...view(stored).values, building: 'A' } }
  assert.match(service.save({}, input).error, /결제·기록/)
  assert.equal(writes, 0); assert.equal(restarts, 0)
  idle = true
  assert.equal(service.save({}, { ...input, values: { ...input.values, building: 'C' } }).success, false)
  assert.equal(writes, 0); assert.equal(restarts, 0)
  assert.equal(service.save({}, input).restartRequired, true)
  assert.equal(writes, 1); assert.equal(restarts, 1)
  assert.equal(stored.env.KIOSK_HARDWARE, 'beach-b')
  assert.equal(service.save({}, input).success, true)
  assert.equal(restarts, 1)
})

test('native save guards reject payment evidence and concurrent work; building restart drains software before relaunch', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  let stored = config('property3'), writes = 0, callback, shutdowns = 0, relaunched = 0, quits = 0
  const context = { createDeviceSettings, registeredDevice: { read: () => stored, write: next => { stored = next; writes++ } },
    app: { isPackaged: true, relaunch: () => { relaunched++ }, quit: () => { quits++ } },
    paymentRecovery: { authorize: () => ({ success: true }) }, paymentDeviceRecoveryBlocked: false,
    global: { kioskActiveOperations: () => 1, shutdownKiosk: async () => { shutdowns++ } },
    cardKey: { needsRecovery: () => false, isBusy: () => false }, tossFrontBridge: { pending: new Map() },
    lastAcceptorCommand: 0, Date: { now: () => 10000 }, SerialPort: { list: () => { throw Error('No port access in QA') } },
    setTimeout: fn => { callback = fn }, console }
  const block = source.slice(source.indexOf('const deviceSettings ='), source.indexOf('ipcMain.handle("device-settings:read"'))
  vm.runInNewContext(block + '\nservice = deviceSettings', context)
  const input = { values: { ...view(stored).values, building: 'A' } }
  context.paymentDeviceRecoveryBlocked = true
  assert.equal(context.service.save({}, input).success, false)
  context.paymentDeviceRecoveryBlocked = false
  for (const field of ['kioskHttpActive', 'kioskCardBusy', 'kioskDeviceRecoveryActive', 'kioskMaintenance', 'kioskPaymentRecoveryActive']) {
    context.global[field] = true
    assert.equal(context.service.save({}, input).success, false)
    context.global[field] = false
  }
  context.global.kioskActiveOperations = () => 2
  assert.equal(context.service.save({}, input).success, false)
  context.global.kioskActiveOperations = () => 1
  assert.equal(writes, 0); assert.equal(callback, undefined)
  assert.equal(context.service.save({}, input).success, true)
  assert.equal(stored.env.KIOSK_HARDWARE, 'beach-b')
  assert.equal(context.global.kioskMaintenance, true)
  assert.equal(context.service.save({}, input).success, false)
  await callback()
  assert.equal(writes, 1); assert.equal(shutdowns, 1); assert.equal(relaunched, 1); assert.equal(quits, 1)
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
    else if (property === 'property3') assert.equal(saved.env.WOOSIM_PRINTER_NAME, '')
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
  assert.equal(service.save({}, { password: 'correct', values: { ...values, bac2400Port: 'COM8' } }).success, false)
  assert.equal(writes, 0)
  assert.equal(service.save({}, { password: 'correct', values }).success, true)
  assert.equal(writes, 1)
  assert.equal(stored.env.TOSS_FRONT_SERIAL_PATH, 'COM8')
})

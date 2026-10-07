const test = require('node:test')
const assert = require('node:assert/strict')
const { createCardKeyService, defaultProfile, roomKey, publicResult } = require('../electron/card-key-service')
const { view, updatedConfig } = require('../electron/device-settings')

function fixture(env = { KIOSK_PROPERTY_ID: 'property1', CARD_DISPENSER_ENABLED: 'true' }, records = new Map()) {
  const mainFrame = { url: 'http://localhost:3000/?mode=web' }, sent = [], progress = [], listeners = new Set()
  const event = { senderFrame: mainFrame, sender: { mainFrame, isDestroyed: () => false, send: (_channel, value) => progress.push(value) } }
  const store = { read: id => records.get(id) || null, write: (id, value) => records.set(id, structuredClone(value)),
    list: () => [...records.values()].filter(value => value.registeredAt).map(({ room, registeredAt }) => ({ room, registeredAt })) }
  let busy = false, hold = false, response = { success: true, settled: true, state: 'taken' }
  const bridge = { isConnected: true, subscribeMessage: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    send: value => {
      sent.push(value)
      if (!hold) queueMicrotask(() => {
        for (const fn of [...listeners]) {
          fn({ type: 'card_progress', requestId: value.requestId, state: 'presented', blocks: 'never-forward' })
          fn({ type: 'card_result', requestId: value.requestId, ...response })
        }
      })
      return true
    } }
  const create = () => createCardKeyService({ env, store, bridge, token: 'x'.repeat(64), timeoutMs: 30,
    authorize: (_event, password) => ({ success: password === 'correct', error: 'auth failed' }), isIdle: () => true,
    setBusy: value => { busy = value } })
  return { service: create(), create, event, sent, progress, records, get busy() { return busy },
    respond: value => { response = value }, hold: () => { hold = true }, listeners }
}

test('card IPC gate rejects unsupported PCs, flag-off, bad auth and cross-room access without hardware I/O', async () => {
  for (const [property, building, flag] of [['property2', '', 'true'], ['property4', '', 'true'], ['property3', 'B', 'true'], ['property3', '', 'true'], ['property1', '', 'false']]) {
    const f = fixture({ KIOSK_PROPERTY_ID: property, KIOSK_BUILDING: building, CARD_DISPENSER_ENABLED: flag })
    assert.equal(f.service.available(f.event), false)
    assert.equal((await f.service.run(f.event, 'status', { password: 'correct' })).success, false)
    assert.equal(f.sent.length, 0)
  }
  for (const [env, room] of [[{ KIOSK_PROPERTY_ID: 'property1', CARD_DISPENSER_ENABLED: 'true' }, 'A101'],
    [{ KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'A', CARD_DISPENSER_ENABLED: 'true' }, 'B101']]) {
    const f = fixture(env)
    assert.equal((await f.service.run(f.event, 'register', { password: 'correct', confirmed: true, room })).success, false)
    assert.equal((await f.service.run(f.event, 'status', { password: 'wrong' })).success, false)
    assert.equal((await f.service.run({ ...f.event, senderFrame: { url: 'https://other.test' } }, 'status', { password: 'correct' })).success, false)
    assert.equal(f.sent.length, 0)
  }
  assert.equal(roomKey(' c - 101 '), 'C101')
})

test('registration stores encrypted-store record but sends only metadata/results to the renderer', async () => {
  const f = fixture()
  f.respond({ success: true, settled: true, uid: '01020304', blocks: { 1: 'ab'.repeat(16) } })
  const result = await f.service.run(f.event, 'register', { password: 'correct', confirmed: true, room: 'C-101' })
  assert.equal(result.success, true)
  assert.equal('blocks' in result || 'uid' in result, false)
  assert.deepEqual(f.progress, [{ state: 'presented' }])
  const record = f.records.get('room-C101')
  assert.equal(record.uid, '01020304')
  assert.equal(record.profile.sectors.length, 16)
  const listing = await f.service.run(f.event, 'list', { password: 'correct' })
  assert.deepEqual(Object.keys(listing.rooms[0]).sort(), ['registeredAt', 'room'])
  assert.equal(JSON.stringify(listing).includes('01020304'), false)
  assert.equal((await f.service.run(f.event, 'register', { password: 'correct', confirmed: true, room: 'C101' })).reason, 'replacement_confirmation_required')
  assert.equal(f.sent.length, 1)
})

test('test issuance is idempotent across service restart and unresolved timeouts keep update blocked', async () => {
  const f = fixture()
  f.records.set('room-C101', { room: 'C101', profile: defaultProfile(), blocks: {}, uid: '01020304' })
  const input = { password: 'correct', room: 'C101', confirmed: true, operationKey: 'bench-test-123' }
  assert.equal((await f.service.run(f.event, 'issue', input)).success, true)
  assert.equal((await f.create().run(f.event, 'issue', input)).success, true)
  assert.equal(f.sent.length, 1)
  f.hold()
  const pending = f.service.run(f.event, 'issue', { ...input, operationKey: 'bench-test-456' })
  assert.equal((await f.service.run(f.event, 'issue', { ...input, operationKey: 'bench-test-789' })).reason, 'busy')
  const result = await pending
  assert.equal(result.reason, 'timeout')
  assert.equal(f.busy, true)
  assert.equal(f.listeners.size, 0)
  assert.equal((await f.create().run(f.event, 'issue', { ...input, operationKey: 'bench-test-456' })).settled, false)
  assert.equal(f.sent.length, 2)
  assert.equal(f.busy, true)
})

test('card port configuration defaults off and rejects collisions and unsupported enable', () => {
  const config = { registered: true, property: 'property1', env: {} }
  const values = view(config).values
  assert.equal(values.cardDispenserEnabled, 'false')
  assert.equal(values.cardDispenserAddress, '00')
  assert.throws(() => updatedConfig(config, { ...values, cardDispenserEnabled: 'true' }), /COM/)
  assert.throws(() => updatedConfig(config, { ...values, cardDispenserEnabled: 'true', cardDispenserPort: 'com4' }), /동일한/)
  const next = updatedConfig(config, { ...values, cardDispenserEnabled: 'true', cardDispenserPort: 'com8', cardDispenserAddress: '8' })
  assert.equal(next.env.CARD_DISPENSER_PORT, 'COM8')
  assert.equal(next.env.CARD_DISPENSER_ENABLED, 'true')
  assert.equal(next.env.CARD_DISPENSER_ADDRESS, '08')
  assert.equal(view(next).values.cardDispenserAddress, '08')
  for (const address of ['', '-1', '16', '0x08', '008', '1.5', 'AB']) {
    assert.throws(() => updatedConfig(config, { ...values, cardDispenserAddress: address }), /장비 주소/)
  }
  assert.throws(() => updatedConfig({ ...config, property: 'property3', env: { KIOSK_BUILDING: 'B' } },
    { ...values, cardDispenserEnabled: 'true', cardDispenserPort: 'COM8' }), /사용할 수 없습니다/)
  assert.deepEqual(publicResult({ success: true, blocks: 'secret', uid: 'secret', profile: 'secret', token: 'secret' }), { success: true })
})

test('failed status polls allow settings recovery but cannot clear an unresolved card operation', async () => {
  const f = fixture(), input = { password: 'correct' }
  const failure = { success: false, reason: 'timeout', settled: false,
    port: 'COM3', baudRate: 9600, address: '08', errorStage: 'ack', receivedBytes: 0 }
  f.respond(failure)
  assert.deepEqual(await f.service.run(f.event, 'status', input), { ...failure, recoveryRequired: false })
  assert.equal(f.busy, false)
  f.respond({ success: false, reason: 'timeout', settled: false })
  assert.equal((await f.service.run(f.event, 'return', { ...input, confirmed: true })).recoveryRequired, true)
  assert.equal(f.busy, true)
  f.respond(failure)
  assert.equal((await f.service.run(f.event, 'status', input)).recoveryRequired, true)
  assert.equal(f.busy, true)
  for (const [sensors, moving] of [[2, false], [0, true], [0, false]]) {
    f.respond({ success: true, sensors, moving })
    const expected = Boolean(sensors || moving)
    assert.equal((await f.service.run(f.event, 'status', input)).recoveryRequired, expected)
    assert.equal(f.busy, expected)
  }
})

test('failed registration returns device diagnostics without saving or exposing card data', async () => {
  const f = fixture()
  const failure = { success: false, reason: 'card_command_failed', settled: true,
    failedCommand: '3B33', deviceCode: 0x45, failedBlock: 1 }
  f.respond({ ...failure, uid: '01020304', blocks: { 1: 'ab'.repeat(16) }, rawResponse: 'private' })
  assert.deepEqual(await f.service.run(f.event, 'register', { password: 'correct', confirmed: true, room: 'C101' }),
    { ...failure, recoveryRequired: false })
  assert.equal(f.records.size, 0)
  assert.equal(f.busy, false)
})

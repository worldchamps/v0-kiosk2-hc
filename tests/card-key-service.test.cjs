const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createCardKeyService, defaultProfile, roomKey, publicResult, CARD_OPERATION_TIMEOUT_MS } = require('../electron/card-key-service')
const { view, updatedConfig } = require('../electron/device-settings')
const { issueTicket, verifyTicket } = require('../electron/card-issue-proof')
const customerEnv = { KIOSK_PROPERTY_ID: 'property1', CARD_DISPENSER_ENABLED: 'true', CARD_BRIDGE_TOKEN: 'a'.repeat(64) }
const ticket = (reservationId = 'test-reservation', room = 'C105', env = customerEnv) => issueTicket({ reservationId, roomNumber: room }, env).ticket

function fixture(env = { KIOSK_PROPERTY_ID: 'property1', CARD_DISPENSER_ENABLED: 'true' }, records = new Map()) {
  const mainFrame = { url: 'http://localhost:3000/?mode=web' }, sent = [], progress = [], listeners = new Set()
  const event = { senderFrame: mainFrame, sender: { mainFrame, isDestroyed: () => false, send: (_channel, value) => progress.push(value) } }
  const store = { read: id => records.get(id) || null, write: (id, value) => records.set(id, structuredClone(value)),
    list: () => [...records.values()].filter(value => value?.registeredAt).map(({ room, registeredAt }) => ({ room, registeredAt })) }
  let busy = false, hold = false, idle = true, response = { success: true, settled: true, state: 'taken' }
  const responses = [], reports = []
  const bridge = { isConnected: true, subscribeMessage: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    send: value => {
      sent.push(value)
      if (!hold) queueMicrotask(() => {
        const next = responses.length ? responses.shift() : response
        for (const fn of [...listeners]) {
          fn({ type: 'card_progress', requestId: value.requestId, state: 'presented', blocks: 'never-forward' })
          fn({ type: 'card_result', requestId: value.requestId, ...next })
        }
      })
      return true
    } }
  const create = () => createCardKeyService({ env, store, bridge, token: 'x'.repeat(64), timeoutMs: 30,
    authorize: (_event, password) => ({ success: password === 'correct', error: 'auth failed' }), isIdle: () => idle,
    isAutoIdle: () => idle, onStatus: value => reports.push(value), setBusy: value => { busy = value } })
  return { service: create(), create, event, sent, progress, records, store, reports, get busy() { return busy },
    respond: value => { response = value }, respondSequence: (...values) => responses.push(...values),
    setIdle: value => { idle = value }, hold: (value = true) => { hold = value }, listeners }
}

test('check-in tickets bind committed reservation, room, property and expiry', () => {
  const now = 1000000, data = { reservationId: 'synthetic', roomNumber: 'C-105' }
  const signed = issueTicket(data, customerEnv, now).ticket
  assert.equal(verifyTicket(signed, customerEnv, now).room, 'C105')
  assert.throws(() => verifyTicket(signed, customerEnv, now + 300000))
  assert.throws(() => verifyTicket(signed + '0', customerEnv, now))
  assert.throws(() => verifyTicket(signed, { ...customerEnv, CARD_BRIDGE_TOKEN: 'b'.repeat(64) }, now))
  assert.throws(() => verifyTicket(signed, { ...customerEnv, KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'A' }, now))
  for (const [property, building] of [['property2', ''], ['property3', 'B'], ['property4', '']])
    assert.equal(issueTicket(data, { ...customerEnv, KIOSK_PROPERTY_ID: property, KIOSK_BUILDING: building }), undefined)
})

test('customer preflight checks registered room and stock without moving a card or requiring admin auth', async () => {
  const f = fixture(customerEnv)
  assert.equal((await f.service.run(f.event, 'ready', { room: 'C105' })).reason, 'room_not_registered')
  assert.equal(f.sent.length, 0)
  f.records.set('room-C105', { room: 'C105' })
  f.respond({ success: true, settled: true, empty: true })
  assert.equal((await f.service.run(f.event, 'ready', { room: 'C105' })).reason, 'empty')
  f.respond({ success: true, settled: true })
  assert.equal((await f.service.run(f.event, 'ready', { room: 'C105' })).success, true)
  assert(f.sent.every(value => value.type === 'card_status'))
  f.respond({ success: false, reason: 'disconnected', settled: false })
  assert.equal((await f.service.run(f.event, 'ready', { room: 'C105' })).success, false)
  assert.equal(f.busy, false)
  const disabled = fixture({ ...customerEnv, CARD_DISPENSER_ENABLED: 'false' })
  assert(disabled.service.checkInRequired(disabled.event))
  assert.equal((await disabled.service.run(disabled.event, 'ready', { room: 'C105' })).reason, 'disabled')
  assert.equal(issueTicket({ reservationId: 'test', roomNumber: 'C105' }, { ...customerEnv, CARD_DISPENSER_ENABLED: 'false' }), undefined)
})

test('valid customer ticket dispenses one UID-only card across duplicate clicks, re-signing and restart', async () => {
  const f = fixture(customerEnv)
  f.records.set('room-C105', { room: 'C105', blocks: {}, uid: '01020304' })
  const first = f.service.run(f.event, 'checkin_issue', { ticket: ticket() })
  const concurrent = await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })
  assert.equal(concurrent.success, false)
  assert.equal((await first).success, true)
  const restarted = f.create()
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket() })).success, true)
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].issueMode, 'uid_only')
  assert.equal(f.records.get('active-check-in'), null)
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket('test-reservation', 'D101') })).success, false)
  assert.equal(f.sent.length, 1)
})

test('customer cannot issue an arbitrary room, an expired ticket or a ticket from a foreign frame', async () => {
  const f = fixture(customerEnv)
  for (const input of [{ room: 'C105' }, { ticket: 'forged' }, { ticket: ticket('foreign', 'A105') },
    { ticket: issueTicket({ reservationId: 'old', roomNumber: 'C105' }, customerEnv, Date.now() - 300001).ticket }])
    assert.equal((await f.service.run(f.event, 'checkin_issue', input)).success, false)
  assert.equal((await f.service.run({ ...f.event, senderFrame: { url: 'http://localhost:3000/' } }, 'checkin_issue', { ticket: ticket() })).success, false)
  assert.equal(f.sent.length, 0)
})

test('uncertain check-in survives restart, blocks another reservation and is resolved only by device recovery', async () => {
  const f = fixture(customerEnv)
  f.records.set('room-C105', { room: 'C105' }); f.hold()
  assert.equal((await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })).settled, false)
  const restarted = f.create()
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket('other') })).reason, 'inspection_required')
  assert.equal(f.sent.length, 1); assert.equal(f.busy, true)
  f.hold(false); f.respond({ success: true, sensors: 0, moving: false })
  assert.equal((await restarted.run(f.event, 'status', { password: 'correct' })).success, true)
  assert.equal(f.busy, false)
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket() })).reason, 'operator_recovered')
  assert.equal(f.sent.length, 2)
})

test('failed durable write prevents card movement and failed result persistence cannot reissue after restart', async () => {
  for (const stage of ['started', 'complete']) {
    const f = fixture(customerEnv); f.records.set('room-C105', { room: 'C105' })
    const write = f.store.write
    f.store.write = (id, value) => { if (value?.state === stage) throw Error('disk full'); return write(id, value) }
    assert.equal((await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })).success, false)
    assert.equal(f.sent.length, stage === 'started' ? 0 : 1)
    assert.equal((await f.create().run(f.event, 'checkin_issue', { ticket: ticket() })).settled, false)
    assert.equal(f.sent.length, stage === 'started' ? 0 : 1)
  }
})

test('startup defers encrypted-store access and keeps a damaged record locked without crashing', () => {
  const f = fixture(customerEnv), read = f.store.read
  f.store.read = () => { throw Error('encrypted store unavailable') }
  const restarted = f.create()
  assert.equal(restarted.needsRecovery(), true)
  assert.equal(restarted.status().state, 'needs_attention')
  assert.equal(f.sent.length, 0)
  f.store.read = read
})

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

test('UID-only issuance is explicit, idempotent, and cannot change mode for an existing request', async () => {
  const f = fixture()
  f.records.set('room-C105', { room: 'C105', profile: defaultProfile(), blocks: {}, uid: '01020304' })
  const input = { password: 'correct', room: 'C105', confirmed: true, operationKey: 'uid-only-test', issueMode: 'uid_only' }
  f.respond({ success: true, settled: true, issueMode: 'uid_only', dispenseMs: 1400, uid: 'private', blocks: {} })
  const result = await f.service.run(f.event, 'issue', input)
  assert.equal(result.dispenseMs, 1400)
  assert.equal(result.issueMode, 'uid_only')
  assert.equal('uid' in result || 'blocks' in result, false)
  assert.equal(f.sent[0].issueMode, 'uid_only')
  assert.equal((await f.create().run(f.event, 'issue', input)).success, true)
  assert.equal((await f.create().run(f.event, 'issue', { ...input, issueMode: 'full' })).reason, 'issue_mode_mismatch')
  assert.equal((await f.create().run(f.event, 'issue', { ...input, issueMode: 'fast' })).reason, 'invalid_issue_mode')
  assert.equal(f.sent.length, 1)
  await f.create().run(f.event, 'issue', { ...input, issueMode: undefined, operationKey: 'full-mode-test' })
  assert.equal(f.sent[1].issueMode, 'full')
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

test('C-building unclaimed card recovers after restart without administrator input', async () => {
  const f = fixture(customerEnv)
  f.records.set('room-C105', { room: 'C105', blocks: {}, uid: '01020304' })
  f.respond({ success: false, reason: 'not_taken', settled: false, state: 'unresolved' })
  assert.equal((await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })).recoveryRequired, true)
  assert(f.records.get('active-check-in')?.id)
  const restarted = f.create()
  assert.equal(restarted.needsRecovery(), true)
  f.setIdle(false)
  assert.equal((await restarted.autoRecover()).reason, 'busy')
  assert.equal(f.sent.length, 1)
  f.setIdle(true)
  f.respondSequence(
    { success: true, bits: 0x0102, sensors: 2, moving: false, reason: 'capture_error' },
    { success: true, settled: true, bits: 0x0100, sensors: 0, reason: 'capture_error' },
    { success: true, settled: true },
    { success: true, sensors: 0, moving: false })
  assert.equal((await restarted.autoRecover()).success, true)
  assert.deepEqual(f.sent.slice(1, 5).map(value => value.type), ['card_status', 'card_capture', 'card_reset', 'card_status'])
  assert.equal(f.records.get('active-check-in'), null)
  assert.equal(f.records.get('operation-' + require('../electron/card-issue-proof').operationId('property1', 'test-reservation')).result.reason, 'auto_recovered')
  f.respond({ success: true, sensors: 0, moving: false })
  assert.equal((await restarted.run(f.event, 'ready', { room: 'C105' })).success, true)
  f.respond({ success: true, settled: true, state: 'taken' })
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket('next-customer') })).success, true)
  assert.equal(f.sent.filter(value => value.type === 'card_issue').length, 2)
  assert.equal(f.sent.filter(value => value.type === 'card_capture').length, 1)
  assert.equal(f.reports.at(-1).state, 'ok')
})

test('physical fault reports needs_attention, then one idle recovery restores card use without dispensing', async () => {
  const f = fixture(customerEnv)
  f.records.set('room-C105', { room: 'C105' })
  f.respond({ success: false, reason: 'not_taken', settled: false })
  await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })
  assert.equal(f.service.status().state, 'recovering')
  f.respond({ success: false, reason: 'disconnected', settled: false })
  assert.equal((await f.service.autoRecover()).state, 'needs_attention')
  assert.equal(f.service.status().reason, 'disconnected')
  assert.equal((await f.service.run(f.event, 'ready', { room: 'C105' })).reason, 'inspection_required')
  assert.equal(f.sent.filter(value => value.type === 'card_issue').length, 1)
  f.respond({ success: true, sensors: 0, moving: false })
  assert.equal((await f.service.autoRecover()).success, true)
  assert.equal(f.service.status().autoRecovery.attempts, 2)
  assert.equal(f.sent.filter(value => value.type === 'card_issue').length, 1)
})

test('payment preempts card recovery after its outstanding status without capture, reset, or card issue', async () => {
  const f = fixture(customerEnv)
  f.hold()
  let continueRecovery = true
  const recovering = f.service.autoRecover(() => continueRecovery)
  assert.equal(f.sent.length, 1)
  assert.equal(f.sent[0].type, 'card_status')
  continueRecovery = false
  for (const listener of [...f.listeners]) listener({ type: 'card_result', requestId: f.sent[0].requestId,
    success: true, sensors: 2, moving: false })
  const result = await recovering
  assert.equal(result.reason, 'recovery_yielded')
  assert.equal(f.sent.length, 1)
  assert.equal(f.busy, false)
  assert.equal(f.listeners.size, 0)
})

test('admin reset remains available while unresolved and a preflight failure releases the durable lock', async () => {
  const f = fixture(customerEnv), admin = { password: 'correct', confirmed: true }
  f.records.set('room-C105', { room: 'C105' })
  f.respond({ success: false, reason: 'not_taken', settled: false })
  await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })
  const restarted = f.create()
  f.respond({ success: true, settled: true, sensors: 0 })
  assert.equal((await restarted.run(f.event, 'reset', admin)).success, true)
  assert.equal(f.records.get('active-check-in'), null)
  f.respond({ success: false, reason: 'empty', settled: true })
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket('preflight') })).recoveryRequired, false)
  assert.equal(f.records.get('active-check-in'), null)
  f.respond({ success: true, settled: true, state: 'taken' })
  assert.equal((await restarted.run(f.event, 'checkin_issue', { ticket: ticket('after-refill') })).success, true)
})

test('failed admin recovery cannot clear a prior unresolved check-in', async () => {
  const f = fixture(customerEnv), admin = { password: 'correct', confirmed: true }
  f.records.set('room-C105', { room: 'C105' })
  f.respond({ success: false, reason: 'not_taken', settled: false })
  await f.service.run(f.event, 'checkin_issue', { ticket: ticket() })
  const restarted = f.create()
  for (const [command, reason] of [['reset', 'card_present'], ['capture', 'capture_full']]) {
    f.respond({ success: false, reason, settled: true })
    const result = await restarted.run(f.event, command, admin)
    assert.equal(result.recoveryRequired, true)
    assert(f.records.get('active-check-in')?.id)
    assert.equal((await restarted.run(f.event, 'ready', { room: 'C105' })).reason, 'inspection_required')
  }
})

test('Electron hardware timeout exceeds the complete Python operation budget', () => {
  const source = readFileSync(require.resolve('../hardware_server/card_dispenser.py'), 'utf8')
  const budgets = Object.fromEntries([...source.matchAll(/^(\w+_BUDGET) = (\d+)$/gm)].map(([, name, seconds]) => [name, Number(seconds)]))
  assert.deepEqual(Object.keys(budgets).sort(), ['CAPTURE_BUDGET', 'ISSUE_BUDGET', 'PICKUP_BUDGET', 'PRESENT_BUDGET'])
  // Registration can use its 30s read budget, then 2s recovery + 3s status + present/pickup/capture.
  assert(CARD_OPERATION_TIMEOUT_MS > (budgets.ISSUE_BUDGET + 2 + 3 + budgets.PRESENT_BUDGET +
    budgets.PICKUP_BUDGET + budgets.CAPTURE_BUDGET + 5) * 1000)
})

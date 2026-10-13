const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { recoverySummary, fingerprint, operationsSignature, verifyOperations, verifyRecoveryCommand, createOperationsReporter } = require('../electron/kiosk-operations')
const identity = { deviceId: 'property3-kiosk-b-32', property: 'property3', building: 'B' }
const firebaseOrder = value => Object.fromEntries(Object.keys(value).sort().map(field => [field, value[field]]))
const raw = JSON.stringify({ isActive: true, acceptedAmount: 70000, recoveryRequired: '예약 충돌', reservationData: { roomNumber: 'B101', guestName: 'private' } })

// Run native configuration, renderer selection and report callbacks without opening Electron or devices.
function nativeOperations({ overlay = true, property = 'property2' } = {}) {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  let popup = null, answer = { raw: null, memory: 'null' }, resets = 0, reloads = 0
  const events = new Map()
  const context = { global: {}, OVERLAY_MODE: overlay, KIOSK_PROPERTY_ID: property, mainWindow: null,
    lastOperationsSnapshot: null, lastPrinterResult: null, deviceRecovery: null, cardRendererIdle: false, lastAcceptorCommand: 0,
    pendingOperations: new Map(), URL, Date: { now: () => 100000 }, require,
    process: { env: { FIREBASE_PRIVATE_KEY: 'test-key' } },
    ipcMain: { on: (name, listener) => events.set(name, listener) },
    setTimeout: callback => setTimeout(callback, 5), clearTimeout, overlayButtonModule: { getKioskPopup: () => popup },
    hardwareBridge: {}, tossFrontBridge: { configured: true, pending: new Map() }, cardKey: { isBusy: () => false },
    cardDispenserEnabled: () => false, usesWoosim: () => property === 'property3',
    createDeviceRecovery: require('../electron/device-recovery').createDeviceRecovery,
    operationsIdentity: () => ({ deviceId: 'property2-kariv-kiosk-01', property, building: '', version: 'QA' }),
    createOperationsReporter: options => options, cardStore: {},
    runRemoteReset: async (_request, _store, _recovery, idle) => { assert(idle()); resets++ },
  }
  vm.runInNewContext(source.slice(source.indexOf('function getOperationsWindow()'), source.indexOf("ipcMain.handle('printer:report-result'")) +
    source.slice(source.indexOf('const cardAutoIdle ='), source.indexOf('const cardStore =')) +
    source.slice(source.indexOf('  const karivOverlay ='), source.indexOf('  setInterval(() => void deviceRecovery.tick()')) +
    source.slice(source.indexOf('  const operations = createOperationsReporter'), source.indexOf('  setInterval(() => void operations.tick()')) +
    '\nglobal.operations = operations; global.cardAutoIdle = cardAutoIdle', context)
  const window = { isDestroyed: () => false, webContents: { reload: () => reloads++,
    mainFrame: { url: 'http://localhost:3000' }, send(name, input) {
      assert.equal(name, 'operations:request')
      if (answer === 'timeout') return
      events.get('operations:response')({ sender: window.webContents, senderFrame: window.webContents.mainFrame },
        { id: input.id, result: input.kind === 'recover' ? { success: true } : answer })
    } } }
  return { options: context.global.operations, context, popup: open => { popup = open ? window : null },
    answer: value => { answer = value }, get resets() { return resets }, get reloads() { return reloads } }
}
test('device recovery reports omit personal data and do not label an active payment as a lock', () => {
  assert.equal(recoverySummary(JSON.stringify({ isActive: true, acceptedAmount: 70000 })), null)
  assert.equal(recoverySummary(null), null)
  assert.equal(recoverySummary(null, 'null'), null)
  assert(recoverySummary('broken', 'null'), 'a null memory snapshot cannot hide existing unreadable journal evidence')
  assert.equal(recoverySummary(raw).amount, 70000)
  assert(!JSON.stringify(recoverySummary(raw)).includes('private'))
  assert.equal(recoverySummary('broken').amount, null)
  assert.equal(recoverySummary('broken', JSON.stringify({ isActive: false }), '저장 기록 확인 실패').reason, '저장 기록 확인 실패')
})

test('Kariv idle overlay reports a signed no-payment state without phantom devices or a main window', async () => {
  const h = nativeOperations(), reports = []
  const reporter = createOperationsReporter({ ...h.options, now: () => 100000,
    fetcher: async (_url, options) => { reports.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) } } })
  await reporter.tick()
  assert.equal(reports.length, 1); assert.equal(reports[0].recovery, null); assert.equal(reports[0].printer, null)
  assert.deepEqual(reports[0].hardware, {})
  assert(verifyOperations(reports[0], operationsSignature(reports[0], 'test-key'), 'test-key', h.options.identity, 100000))
  assert(h.context.global.cardAutoIdle())
  for (const config of [{ overlay: false, property: 'property2' }, { overlay: true, property: 'property1' }, { overlay: false, property: 'property3' }]) {
    const other = nativeOperations(config)
    assert.deepEqual(Object.keys(other.context.deviceRecovery.hardware), ['acceptor', 'dispenser', 'printer', 'cardTerminal'])
  }
})

test('overlay popup snapshot failures still report hardware, keep prior evidence and never become no-payment', async () => {
  const h = nativeOperations()
  h.popup(true); h.answer({ raw, memory: raw })
  assert.equal((await h.options.read()).raw, raw)
  assert.equal(h.context.global.cardAutoIdle(), false, 'a popup blocks native resets')
  h.answer('timeout')
  const unknown = await h.options.read()
  assert.equal(unknown.raw, raw); assert.equal(unknown.paymentUnavailable, true)
  assert(recoverySummary(unknown.raw, unknown.memory, unknown.storageError))
  assert.deepEqual(Object.keys(unknown.hardware), [])
  h.popup(false)
  assert.equal((await h.options.read()).paymentUnavailable, true, 'closing an unreadable popup cannot erase the warning')
  h.popup(true); h.answer({ raw: null, memory: 'null' })
  const empty = await h.options.read()
  assert.equal(empty.paymentUnavailable, undefined); assert.equal(recoverySummary(empty.raw, empty.memory, empty.storageError), null)
})

test('unavailable popup evidence blocks even a valid archive signature while native reset reporting continues', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), module = { exports: {} }
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/kiosk-operations'), 'utf8'), {
    module, Buffer, Date, AbortSignal, require: name => name === './pms-card-public-key.json' ? { publicKey: keys.publicKey } : require(name),
  })
  const h = nativeOperations(), reports = []
  h.popup(true); h.answer('timeout')
  const archive = { id: crypto.randomUUID(), action: 'archive_payment', deviceId: h.options.identity.deviceId, property: 'property2', building: '',
    fingerprint: fingerprint(null, 'null'), confirmed: true, createdAt: 90000, expiresAt: 200000 }
  let request = archive
  const reporter = module.exports.createOperationsReporter({ ...h.options, now: () => 100000,
    fetcher: async (_url, options) => { reports.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ command: {
      request: firebaseOrder(request), signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(request)), keys.privateKey).toString('base64'),
    } }) } },
  })
  await reporter.tick()
  assert.equal(h.reloads, 0); assert.equal(reports[0].result, null); assert(reports[0].recovery)
  h.popup(false)
  request = { id: crypto.randomUUID(), action: 'reset_device', device: 'all', deviceId: h.options.identity.deviceId,
    property: 'property2', building: '', createdAt: 90000, expiresAt: 210000 }
  await reporter.tick(); await reporter.tick()
  assert.equal(h.resets, 1); assert.equal(reports.at(-1).result.status, 'completed')
  h.popup(true); h.answer({ raw, memory: raw })
  request = { ...archive, fingerprint: fingerprint(raw, raw) }
  await reporter.tick(); await reporter.tick()
  assert.equal(h.reloads, 1); assert.equal(reports.at(-1).result.id, archive.id)
})
test('property1 native Bixolon recovery reads the existing server status and restores only the printer', async () => {
  const h = nativeOperations({ overlay: false, property: 'property1' })
  h.context.mainWindow = { isDestroyed: () => false }
  h.context.cardRendererIdle = true
  const listeners = new Set(), sent = []
  let ready = true
  h.context.hardwareBridge.subscribeMessage = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  h.context.hardwareBridge.send = message => {
    sent.push(message.type)
    queueMicrotask(() => { for (const fn of listeners) fn({ type: 'printer_status', ready }) })
    return true
  }
  h.context.deviceRecovery.fault('printer', 'printer_unavailable')
  await h.context.deviceRecovery.reset('printer')
  assert.equal(h.context.deviceRecovery.hardware.printer.state, 'ok')
  assert.equal(h.context.deviceRecovery.hardware.dispenser.state, 'recovering')
  ready = false
  await assert.rejects(h.context.deviceRecovery.reset('printer'), /printer_unavailable/)
  assert.equal(h.context.deviceRecovery.hardware.printer.state, 'needs_attention')
  assert.equal(h.context.global.kioskDeviceRecoveryActive, false)
  assert.equal(listeners.size, 0)
  assert.deepEqual(sent, ['printer_status', 'printer_status'])
})
test('reports require a recent signature and the exact property/building/device', () => {
  const body = { ...identity, version: 'QA', at: 100000, recovery: recoverySummary(raw), printer: null,
    hardware: { cardDispenser: { state: 'needs_attention', reason: 'card_present', lastResetAt: 90000, lastResetResult: 'card_present', empty: false } }, result: null }
  const sig = operationsSignature(body, 'test-key')
  assert(verifyOperations(body, sig, 'test-key', identity, 100000))
  assert(!verifyOperations(body, sig, 'wrong-key', identity, 100000))
  assert(!verifyOperations(body, sig, 'test-key', { ...identity, building: 'A' }, 100000))
  assert(!verifyOperations(body, sig, 'test-key', identity, 200000))
  assert(!verifyOperations({ ...body, recovery: { ...body.recovery, amount: -1 } }, sig, 'test-key', identity, 100000))
  for (const invalid of [{ ...body.hardware, cardDispenser: { ...body.hardware.cardDispenser, reason: 'x'.repeat(81) } },
    { ...body.hardware, acceptor: { state: 'ok', reason: null, lastResetAt: null, lastResetResult: null, empty: true } },
    { unknown: body.hardware.cardDispenser }]) {
    const changed = { ...body, hardware: invalid }
    assert(!verifyOperations(changed, operationsSignature(changed, 'test-key'), 'test-key', identity, 100000))
  }
})
test('remote recovery rejects forged, expired, another-device and changed-transaction requests', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const request = { id: crypto.randomUUID(), action: 'archive_payment', ...identity,
    fingerprint: fingerprint(raw), confirmed: true, createdAt: 90000, expiresAt: 200000 }
  const job = { request, signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(request)), keys.privateKey).toString('base64') }
  assert(verifyRecoveryCommand(job, raw, identity, 100000, keys.publicKey))
  assert(!verifyRecoveryCommand(job, raw + ' ', identity, 100000, keys.publicKey))
  assert(!verifyRecoveryCommand(job, raw, identity, 100000, keys.publicKey, JSON.stringify({ acceptedAmount: 80000 })), 'unsaved cash changes invalidate an old approval')
  assert(!verifyRecoveryCommand(job, raw, { ...identity, deviceId: 'another-device' }, 100000, keys.publicKey))
  assert(!verifyRecoveryCommand(job, raw, identity, 200000, keys.publicKey))
  assert(!verifyRecoveryCommand({ ...job, request: { ...request, confirmed: false } }, raw, identity, 100000, keys.publicKey))
})
test('reset_device uses the existing PMS signing order, exact field set and scoped device', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const request = { id: crypto.randomUUID(), action: 'reset_device', device: 'cardDispenser',
    deviceId: identity.deviceId, property: identity.property, building: identity.building, createdAt: 100000, expiresAt: 220000 }
  const sign = value => ({ request: value, signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(value)), keys.privateKey).toString('base64') })
  assert(verifyRecoveryCommand(sign(request), null, identity, 100001, keys.publicKey))
  for (const changed of [{ ...request, device: 'issue' }, { ...request, deviceId: 'another-device' },
    { ...request, action: 'unknown' }, { ...request, expiresAt: 220001 }])
    assert(!verifyRecoveryCommand(sign(changed), null, identity, 100001, keys.publicKey))
  assert(!verifyRecoveryCommand({ ...sign(request), signature: 'forged' }, null, identity, 100001, keys.publicKey))
  assert(!verifyRecoveryCommand(sign(request), null, identity, 220000, keys.publicKey))
})
for (const action of ['archive_payment', 'reset_device']) {
  test(`${action}: Firebase sorted commands verify and extra, missing, tampered, expired or foreign commands fail`, () => {
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const request = action === 'archive_payment'
      ? { id: crypto.randomUUID(), action, ...identity, fingerprint: fingerprint(raw), confirmed: true, createdAt: 100000, expiresAt: 220000 }
      : { id: crypto.randomUUID(), action, device: 'dispenser', ...identity, createdAt: 100000, expiresAt: 220000 }
    const sign = value => ({ request: firebaseOrder(value),
      signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(value)), keys.privateKey).toString('base64') })
    const job = sign(request)
    assert.notEqual(Object.keys(job.request).join(), Object.keys(request).join())
    assert(verifyRecoveryCommand(job, raw, identity, 100001, keys.publicKey))
    assert(!verifyRecoveryCommand(job, raw, identity, 220000, keys.publicKey))
    assert(!verifyRecoveryCommand(job, raw, identity, 99999, keys.publicKey))
    for (const changed of [{ ...identity, deviceId: 'another-device' }, { ...identity, property: 'property1' }, { ...identity, building: 'A' }])
      assert(!verifyRecoveryCommand(job, raw, changed, 100001, keys.publicKey))
    assert(!verifyRecoveryCommand({ ...job, request: firebaseOrder({ ...request, extra: true }) }, raw, identity, 100001, keys.publicKey))
    assert(!verifyRecoveryCommand(sign({ ...request, extra: true }), raw, identity, 100001, keys.publicKey))
    for (const field of Object.keys(request)) {
      assert(!verifyRecoveryCommand({ ...job, request: firebaseOrder({ ...request, [field]: 'tampered' }) }, raw, identity, 100001, keys.publicKey))
      const missing = { ...request }; delete missing[field]
      assert(!verifyRecoveryCommand(sign(missing), raw, identity, 100001, keys.publicKey))
      assert(!verifyRecoveryCommand(sign({ ...missing, extra: true }), raw, identity, 100001, keys.publicKey))
    }
  })
}
test('the one-slot reporter defers busy reset and reports failed/busy after two-minute expiry only once', async () => {
  const fs = require('node:fs'), vm = require('node:vm')
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const request = { id: crypto.randomUUID(), action: 'reset_device', device: 'dispenser',
    deviceId: identity.deviceId, property: identity.property, building: identity.building, createdAt: 100000, expiresAt: 220000 }
  const command = { request, signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(request)), keys.privateKey).toString('base64') }
  command.request = firebaseOrder(request)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/kiosk-operations'), 'utf8'), {
    module, Buffer, Date, AbortSignal, require(name) {
      return name === './pms-card-public-key.json' ? { publicKey: keys.publicKey } : require(name)
    },
  })
  let now = 100001, attempts = 0
  const reports = []
  const reporter = module.exports.createOperationsReporter({ identity: { ...identity, version: 'QA' }, key: 'test-key',
    now: () => now, read: async () => ({ raw: null, memory: '{"isActive":false}', hardware: {} }),
    recover: async () => { attempts++; throw Error('busy') },
    fetcher: async (_url, options) => { reports.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ command }) } },
  })
  await reporter.tick()
  assert.equal(attempts, 1); assert.equal(reports[0].result, null)
  now = 220001; await reporter.tick(); await reporter.tick()
  assert.equal(attempts, 2)
  assert.deepEqual(reports[2].result, { id: request.id, status: 'failed', error: 'busy' })
})

test('device reporting rejects unsigned requests, preserves command scope and acknowledges only the matching command', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
  const key = 'synthetic-device-key', id = crypto.randomUUID()
  let command = { request: { id, expiresAt: Date.now() + 100000 }, status: 'pending' }, device, writes = 0
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../app/api/kiosk-operations-agent/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process: { env: { KIOSK_DEVICE_ID: identity.deviceId, FIREBASE_PRIVATE_KEY: key } }, require(name) {
    if (name === 'next/server') return { NextResponse: Response }
    if (name === '@/electron/kiosk-operations') return { verifyOperations }
    if (name === '@/lib/kiosk-scope') return { getKioskScope: () => identity }
    if (name === '@/lib/firebase-admin') return { getDB: () => ({ ref(path) {
      assert.equal(path.split('/')[2], identity.deviceId)
      return { once: async () => ({ val: () => command }), transaction: async fn => {
        assert.equal(fn(null), null); command = fn(command); writes++;
      }, set: async value => { device = value; writes++; } }
    } }) }
    throw Error(name)
  } })
  const body = { ...identity, version: 'QA', at: Date.now(), recovery: recoverySummary(raw), printer: { at: Date.now(), status: 'failed', roomNumber: 'B101', error: 'printer offline' }, hardware: {}, result: null }
  const send = (value, signature = operationsSignature(value, key)) => exports.POST(new Request('http://localhost/api/kiosk-operations-agent', {
    method: 'POST', body: JSON.stringify(value), headers: { 'x-kiosk-operations-signature': signature },
  }))
  assert.equal((await send(body, 'bad')).status, 403); assert.equal(writes, 0)
  assert.equal((await send({ ...body, building: 'A' })).status, 403)
  assert.equal((await (await send(body)).json()).command.request.id, id)
  assert.equal(device.printer.error, 'printer offline'); assert.equal(device.recovery.amount, 70000)
  assert.equal(JSON.stringify(device.hardware), '{}')
  await send({ ...body, result: { id: crypto.randomUUID(), status: 'completed', error: '' } })
  assert.equal(command.status, 'pending')
  assert.equal((await (await send({ ...body, result: { id, status: 'completed', error: '' } })).json()).command, null)
  assert.equal(command.status, 'completed')
})

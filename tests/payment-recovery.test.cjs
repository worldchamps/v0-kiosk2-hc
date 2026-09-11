const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { createPaymentRecovery, STORAGE_KEY } = require('../electron/payment-recovery')

const existingPassword = fs.readFileSync(path.join(__dirname, '../components/kiosk-layout.tsx'), 'utf8')
  .match(/const adminPassword = "([^"]+)"/)[1]
const base = { isActive: true, method: 'cash', acceptedAmount: 0, requiredAmount: 30000,
  acceptedBills: [], sessionStartTime: 1789147000000, recoveryRequired: 'Synthetic unresolved cash cancellation' }

function fixture(session = base, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-payment-recovery-test-'))
  let raw = typeof session === 'string' ? session : JSON.stringify(session), idle = true, stop = true, clock = 100000
  const original = raw, key = crypto.randomBytes(32), calls = { stop: 0, busy: [] }
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(text) { const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
      return Buffer.concat([nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]) },
    decryptString(data) { const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
      cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString('utf8') },
  }
  const frame = { url: 'http://localhost:3000/kiosk/A' }
  const event = { senderFrame: frame, sender: { mainFrame: frame, executeJavaScript: async source => {
    assert.equal(source, `localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`); return raw
  } } }
  const service = createPaymentRecovery({ app: { getPath: () => directory, getVersion: () => 'test' }, safeStorage,
    isIdle: () => idle, stopCash: async () => { calls.stop++; return stop }, setBusy: value => calls.busy.push(value), now: () => clock,
    ...overrides })
  const input = { password: process.env.KIOSK_ADMIN_PASSWORD || existingPassword, expectedRaw: raw,
    memorySnapshot: typeof session === 'string' ? JSON.stringify({ isActive: false }) : JSON.stringify(session),
    confirmed: true, resolution: 'zero_cash', note: '현금 미투입 취소' }
  return { directory, raw: () => raw, original, calls, safeStorage, service, event, input,
    setRaw: value => { raw = value }, setIdle: value => { idle = value }, setStop: value => { stop = value },
    advance: value => { clock += value }, archive: options => service.archive(event, { ...input, ...options }) }
}

test('operator recovery requires existing password, same-origin main frame and rate limits incorrect attempts', () => {
  const h = fixture()
  const nested = { ...h.event, senderFrame: { url: 'http://localhost:3000/' } }
  assert.equal(h.service.authorize(nested, h.input.password).success, false)
  for (let i = 0; i < 5; i++) assert.equal(h.service.authorize(h.event, 'wrong').success, false)
  assert.equal(h.service.authorize(h.event, h.input.password).success, false)
  h.advance(60001)
  assert.equal(h.service.authorize(h.event, h.input.password).success, true)
  assert.deepEqual(h.calls.busy, []); assert.equal(h.calls.stop, 0)
})

test('zero cash is encrypted, fsynced and round-trip verified before unlock permission; retry reuses archive', async () => {
  const h = fixture()
  const result = await h.archive()
  assert.equal(result.success, true)
  assert.equal(h.raw(), h.original); assert.equal(h.calls.stop, 1)
  const file = path.join(h.directory, 'payment-recovery-archive', result.archiveId + '.bin')
  const encrypted = fs.readFileSync(file)
  assert(!encrypted.includes(Buffer.from(h.original)))
  const record = JSON.parse(h.safeStorage.decryptString(encrypted))
  assert.equal(record.original, h.original); assert.equal(record.financialCommandsSent, 0)
  assert.equal(record.memorySnapshot, h.input.memorySnapshot)
  assert(!Object.hasOwn(record, 'password'))
  assert.deepEqual(await h.archive(), result)
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1)
  assert(fs.readFileSync(file).equals(encrypted))
})

test('reviewed card-only failure does not require a cash device or send financial commands', async () => {
  const h = fixture({ ...base, method: 'card', cardInFlight: true, recoveryRequired: 'Toss recovery unknown' })
  h.setStop(false)
  const result = await h.archive({ resolution: 'operator_resolved', note: '승인 내역 없음 확인' })
  assert.equal(result.success, true); assert.equal(h.calls.stop, 0); assert.equal(h.raw(), h.original)
})

test('inserted cash cannot use zero-cash or card-only resolution; explicit settlement preserves original amount', async () => {
  const h = fixture({ ...base, acceptedAmount: 10000, acceptedBills: [10000] })
  assert.equal((await h.archive()).success, false)
  assert.equal((await h.archive({ resolution: 'operator_resolved', note: '승인 내역 없음 확인' })).success, false)
  assert.equal(h.calls.stop, 0)
  assert.equal((await h.archive({ resolution: 'operator_resolved', note: '관리자 정산 완료' })).success, true)
  assert.equal(JSON.parse(h.raw()).acceptedAmount, 10000)
})

test('busy operations, changed snapshot, missing confirmation and failed stop never grant unlock', async () => {
  const h = fixture()
  h.setIdle(false); assert.equal((await h.archive()).success, false); h.setIdle(true)
  assert.equal((await h.archive({ confirmed: false })).success, false)
  h.setRaw(h.original + ' '); assert.equal((await h.archive()).success, false); h.setRaw(h.original)
  h.setStop(false); assert.equal((await h.archive()).success, false)
  assert.equal(fs.existsSync(path.join(h.directory, 'payment-recovery-archive')), false)
  assert.equal(h.raw(), h.original); assert.equal(h.calls.busy.at(-1), false)
})

test('archive failure never exposes raw secrets or removes the original', async () => {
  const h = fixture(base, { safeStorage: { isEncryptionAvailable: () => true, encryptString: () => { throw Error('sensitive provider detail') } } })
  const result = await h.archive()
  assert.equal(result.success, false); assert(!JSON.stringify(result).includes('sensitive provider detail'))
  assert.equal(h.raw(), h.original); assert.equal(h.calls.busy.at(-1), false)
})

test('malformed storage can be preserved verbatim only after operator settlement and inlet stop', async () => {
  const h = fixture('{malformed original')
  assert.equal((await h.archive()).success, false)
  assert.equal((await h.archive({ resolution: 'operator_resolved', note: '관리자 정산 완료' })).success, true)
  assert.equal(h.raw(), h.original); assert.equal(h.calls.stop, 1)
})

test('simultaneous native archive requests cannot overlap device commands', async () => {
  let release
  const h = fixture(base, { stopCash: () => new Promise(resolve => { release = resolve }) })
  const first = h.archive()
  const second = await h.archive()
  assert.equal(second.success, false)
  assert.match(second.error, /진행 중/)
  release(true)
  assert.equal((await first).success, true)
  assert.deepEqual(h.calls.busy, [true, false])
})

test('unsaved cash evidence is archived and cannot masquerade as zero cash', async () => {
  const h = fixture()
  const memorySnapshot = JSON.stringify({ ...base, acceptedAmount: 10000, acceptedBills: [10000] })
  assert.equal((await h.archive({ memorySnapshot })).success, false)
  const result = await h.archive({ memorySnapshot, resolution: 'operator_resolved', note: '관리자 정산 완료' })
  assert.equal(result.success, true)
  const file = path.join(h.directory, 'payment-recovery-archive', result.archiveId + '.bin')
  const record = JSON.parse(h.safeStorage.decryptString(fs.readFileSync(file)))
  assert.equal(record.original, h.original)
  assert.equal(JSON.parse(record.memorySnapshot).acceptedAmount, 10000)
})

test('initial storage failure can archive an active memory-only transaction', async () => {
  const h = fixture()
  h.setRaw(null)
  const result = await h.archive({ expectedRaw: null, resolution: 'operator_resolved', note: '관리자 정산 완료' })
  assert.equal(result.success, true)
  assert.equal(h.raw(), null)
  const file = path.join(h.directory, 'payment-recovery-archive', result.archiveId + '.bin')
  const record = JSON.parse(h.safeStorage.decryptString(fs.readFileSync(file)))
  assert.equal(record.original, null)
  assert.equal(record.memorySnapshot, h.input.memorySnapshot)
})

function nativeWiring() {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const snippet = source.slice(source.indexOf('let lastAcceptorCommand = 0'), source.indexOf('tossFrontBridge.on("status"'))
  let captured, listener, timeout, cleanups = 0, sends = [], clock = 100000
  const state = { kioskHttpActive: 0, kioskActiveOperations: () => 1 }
  const hardwareBridge = { isConnected: true, subscribeMessage: fn => { listener = fn; return () => { cleanups++; listener = null } },
    send: value => { sends.push(JSON.parse(JSON.stringify(value))); return true } }
  const tossFrontBridge = { pending: new Map() }
  vm.runInNewContext(snippet, { app: {}, require: () => ({ safeStorage: {} }), createPaymentRecovery: options => { captured = options; return {} },
    hardwareBridge, tossFrontBridge, global: state, ipcMain: { handle() {} }, Date: { now: () => clock },
    setTimeout: fn => { timeout = fn; return 1 }, clearTimeout: () => { timeout = null } })
  return { get options() { return captured }, hardwareBridge, tossFrontBridge, state, sends,
    message: value => listener?.(value), expire: () => timeout?.(), advance: ms => { clock += ms },
    get cleaned() { return cleanups > 0 && listener === null && timeout === null } }
}

for (const ack of [{ type: 'acceptor_ok', data: 0 }, { type: 'acceptor_raw', packet: [0x24, 0x4f, 0x4b, 0, 0x9a] }]) {
  test(`native recovery sends only disable CONFIG and accepts ${ack.type}`, async () => {
    const h = nativeWiring(), pending = h.options.stopCash()
    assert.deepEqual(h.sends, [{ type: 'raw_acceptor', data: [0x24, 0x53, 0x43, 0x1c, 0xb2] }])
    h.message(ack); assert.equal(await pending, true); assert(h.cleaned)
    assert.equal(h.options.isIdle(), false); h.advance(3501); assert.equal(h.options.isIdle(), true)
  })
}

for (const outcome of ['ng', 'invalid-ack-timeout', 'disconnected', 'send-failure', 'send-throw']) {
  test(`native recovery ${outcome} never reports a stopped inlet`, async () => {
    const h = nativeWiring()
    if (outcome === 'disconnected') h.hardwareBridge.isConnected = false
    if (outcome === 'send-failure') h.hardwareBridge.send = () => false
    if (outcome === 'send-throw') h.hardwareBridge.send = () => { throw new Error('closed socket') }
    const pending = h.options.stopCash()
    if (outcome === 'ng') h.message({ type: 'acceptor_ng' })
    if (outcome === 'invalid-ack-timeout') {
      h.message({ type: 'acceptor_ok', data: 'unknown' })
      h.message({ type: 'acceptor_raw', packet: [0x24, 0x4f, 0x4b, 0, 0] })
      h.message({ type: 'dispenser_ok', data: 0 }); h.expire()
    }
    assert.equal(await pending, false)
    if (outcome !== 'disconnected') assert(h.cleaned)
  })
}

test('native recovery idle guard checks outstanding card, HTTP and IPC operations', () => {
  const h = nativeWiring(); assert(h.options.isIdle())
  h.tossFrontBridge.pending.set('test', true); assert.equal(h.options.isIdle(), false); h.tossFrontBridge.pending.clear()
  h.state.kioskHttpActive = 1; assert.equal(h.options.isIdle(), false); h.state.kioskHttpActive = 0
  h.state.kioskActiveOperations = () => 2; assert.equal(h.options.isIdle(), false)
  h.options.setBusy(true); assert.equal(h.state.kioskPaymentRecoveryActive, true)
  h.options.setBusy(false); assert.equal(h.state.kioskPaymentRecoveryActive, false)
})

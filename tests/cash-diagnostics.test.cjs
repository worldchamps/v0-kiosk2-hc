const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')
const { createCashTrace, createCashDiagnostics } = require('../electron/cash-diagnostics')

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-cash-trace-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const trace = createCashTrace(dir, options.maxBytes)
  const listeners = new Set(), sent = [], busy = []
  let raw = null, idle = true, clock = 10000, valid = true
  const bridge = { isConnected: true,
    subscribeMessage(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    send(message) { sent.push(message); return true },
  }
  const service = createCashDiagnostics({ authorize: () => ({ success: valid, error: valid ? undefined : 'auth' }),
    isIdle: () => idle, setBusy: value => busy.push(value), readPayment: async () => raw,
    bridge, trace, now: () => clock, observeMs: 25, timeoutMs: 10 })
  return { dir, trace, service, bridge, sent, busy, listeners,
    payment: value => { raw = value }, idle: value => { idle = value }, auth: value => { valid = value },
    reply: (elapsed, type = 'acceptor_ok') => { clock = 10000 + elapsed; for (const fn of listeners) fn({ type, data: 0 }) },
    run: (extra = {}) => service.run({}, { password: 'never-log-password', command: 'stop', confirmed: true, ...extra }),
  }
}

test('native diagnostic rejects unauthorized, unconfirmed, busy and any saved payment without sending', async t => {
  const h = fixture(t)
  h.auth(false); assert.equal((await h.run()).success, false); h.auth(true)
  for (const input of [{ confirmed: false }, { command: 'dispense' }, { command: '__proto__' }]) assert.equal((await h.run(input)).success, false)
  h.idle(false); assert.equal((await h.run()).success, false); h.idle(true)
  for (const raw of ['{bad', '{}', JSON.stringify({ isActive: false, acceptedAmount: 60000 })]) {
    h.payment(raw); assert.equal((await h.run()).success, false)
  }
  h.payment(null); h.bridge.isConnected = false; assert.equal((await h.run()).success, false)
  assert.equal(h.sent.length, 0)
  assert.equal(h.busy.at(-1), false)
})

test('diagnostic observes late replies and blocks a competing command for the entire window', async t => {
  const h = fixture(t)
  const pending = h.run({ command: 'reset' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await h.run()).success, false)
  h.reply(12)
  assert.equal(h.busy.at(-1), true)
  const result = await pending
  assert.equal(result.result, 'late_ok')
  assert.equal(result.elapsedMs, 12)
  assert.deepEqual(h.sent, [{ type: 'raw_acceptor', data: [0x24, 0x52, 0x53, 0x54, 0xf9] }])
  assert.equal(h.listeners.size, 0)
  assert.equal(h.busy.at(-1), false)
})

test('stop command distinguishes timely OK, NG, no response, and transport failure', async t => {
  for (const expected of ['ok', 'ng', 'timeout', 'send_failed']) {
    const h = fixture(t)
    if (expected === 'send_failed') h.bridge.send = () => false
    const pending = h.run()
    await new Promise(resolve => setImmediate(resolve))
    if (expected === 'ok' || expected === 'ng') h.reply(3, expected === 'ok' ? 'acceptor_ok' : 'acceptor_ng')
    assert.equal((await pending).result, expected)
    if (h.sent.length) assert.deepEqual(h.sent[0].data, [0x24, 0x53, 0x43, 0x1c, 0xb2])
    assert.equal(h.listeners.size, 0)
    assert.equal(h.busy.at(-1), false)
  }
})

test('persistent trace keeps protocol only, rotates, and retains the latest failure snapshot', async t => {
  const h = fixture(t, { maxBytes: 250 })
  for (let i = 0; i < 30; i++) h.trace.write('renderer', { event: 'send', bytes: [0x24, i], password: 'secret', guestName: 'private-guest' })
  h.trace.write('renderer', { event: 'result', result: 'timeout', elapsedMs: 3000, bytes: [0x24, 0x52, 0x53, 0x54, 0xf9] })
  const record = h.trace.read()
  assert.equal(record.success, true)
  assert.match(record.text, /timeout/)
  assert(fs.existsSync(path.join(h.dir, 'cash-last-failure.jsonl')))
  assert(fs.readdirSync(h.dir).length <= 5)
  for (const name of fs.readdirSync(h.dir)) assert.doesNotMatch(fs.readFileSync(path.join(h.dir, name), 'utf8'), /secret|private-guest|password/)
})

test('adapter rejection codes reach cash-device trace without request IDs or personal fields', async t => {
  const h = fixture(t), stream = new PassThrough()
  h.trace.capture(stream)
  stream.end('2026-10-13 19:10:00,000 - BAC2400 - WARNING - Cash adapter outcome: source=adapter target=acceptor reason=payout_uncertain\n')
  await new Promise(resolve => setImmediate(resolve))
  h.trace.write('bridge', { event: 'result', result: 'ng', source: 'board_status', target: 'dispenser',
    reason: 'dispenser_board_error', requestId: 'private-request', maskedCardNumber: 'private-card' })
  const rows = h.trace.read().text.split('\n').map(JSON.parse)
  assert.equal(rows[0].reason, 'payout_uncertain')
  assert.equal(rows[0].source, 'adapter')
  assert.equal(rows[1].source, 'board_status')
  assert.doesNotMatch(h.trace.read().text, /private|requestId|CardNumber/)
})

test('hardware capture records real serial bytes and fixed error codes, excludes unrelated output', async t => {
  const h = fixture(t), stream = new PassThrough()
  h.trace.capture(stream)
  stream.write('2026-09-17 10:00:00,000 - SerialManager - INFO - [Acceptor] Sent: 2452')
  stream.write('5354F9\n2026-09-17 10:00:00,001 - SerialManager - INFO - [Acceptor] Received: 244F4B009A\n')
  stream.write('2026-09-17 10:00:00,002 - SerialManager - ERROR - [Acceptor] Read error: secret-path\n')
  stream.end('Printer: private-guest\ncredentials: secret-token\n')
  await new Promise(resolve => setImmediate(resolve))
  const text = h.trace.read().text
  assert.match(text, /"event":"send"/)
  assert.match(text, /"event":"receive"/)
  assert.match(text, /read_error/)
  assert.doesNotMatch(text, /secret|private-guest|Printer/)
})

test('integrated board serial and metadata trace preserves response bytes without inventing versions or retaining secrets', async t => {
  const h = fixture(t), stream = new PassThrough()
  h.trace.capture(stream)
  stream.end('2026-10-13 10:00:00,000 - SerialManager - INFO - [BAC2400] Received: 22041B1100121C\n')
  h.trace.write('bridge', { event: 'board_info', protocol: 'bac2400-tlv', version: 'made-up-version',
    responseFields: { '0x1B': '110012', '0x14': '12', secret: 'guest-name' }, privateKey: 'secret' })
  await new Promise(resolve => setImmediate(resolve))
  const text = h.trace.read().text
  assert.match(text, /"event":"receive"/)
  assert.match(text, /"0x1B":"110012"/)
  assert.match(text, /"version":null,"versionVerified":false/)
  assert.doesNotMatch(text, /made-up|privateKey|guest-name|secret/)
})

test('logging storage failure does not throw and blocks a diagnostic that cannot save its evidence', async t => {
  const h = fixture(t)
  const file = path.join(h.dir, 'not-directory')
  fs.writeFileSync(file, 'keep')
  const trace = createCashTrace(file)
  assert.doesNotThrow(() => trace.write('renderer', { event: 'result', result: 'timeout' }))
  assert.equal(trace.read().success, false)
  const service = createCashDiagnostics({ authorize: () => ({ success: true }), isIdle: () => true,
    setBusy() {}, readPayment: async () => null, bridge: h.bridge, trace })
  assert.equal((await service.run({}, { command: 'stop', confirmed: true })).success, false)
  assert.equal(h.sent.length, 0)
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep')
})

test('MULTI3400 TX RX, board version and failure source survive the cash trace allowlist', async t => {
  const h = fixture(t), stream = new PassThrough()
  h.trace.capture(stream)
  stream.end('2026-10-13 21:00:00,000 - SerialManager - INFO - [MULTI3400] Sent: FE0D1100000000000000000000E2\n' +
    '2026-10-13 21:00:00,001 - SerialManager - INFO - [MULTI3400] Received: FE1213471100000000000100000000000012BA\n' +
    '2026-10-13 21:00:00,002 - MULTI3400 - WARNING - Cash adapter outcome: source=board_ng target=dispenser reason=board_nak\n')
  h.trace.write('bridge', { event: 'board_info', protocol: 'multi3400-fe', version: '0x12', versionVerified: true,
    responseFields: { '0x13': '47110000000000010000000000000012', secret: 'guest' } })
  await new Promise(resolve => setImmediate(resolve))
  const rows = h.trace.read().text.split('\n').map(JSON.parse)
  assert.equal(rows.find(row => row.event === 'board_info').version, '0x12')
  assert.equal(rows.find(row => row.event === 'board_info').versionVerified, true)
  assert.equal(rows.find(row => row.event === 'send').bytes.length, 14)
  assert.equal(rows.find(row => row.event === 'receive').bytes.length, 19)
  assert.equal(rows.find(row => row.reason === 'board_nak').source, 'board_ng')
  assert.doesNotMatch(h.trace.read().text, /guest|secret/)
})

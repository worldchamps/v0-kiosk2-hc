const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { recoverySummary, fingerprint, operationsSignature, verifyOperations, verifyRecoveryCommand, createOperationsReporter } = require('../electron/kiosk-operations')
const identity = { deviceId: 'property3-kiosk-b-32', property: 'property3', building: 'B' }
const raw = JSON.stringify({ isActive: true, acceptedAmount: 70000, recoveryRequired: '예약 충돌', reservationData: { roomNumber: 'B101', guestName: 'private' } })
test('device recovery reports omit personal data and do not label an active payment as a lock', () => {
  assert.equal(recoverySummary(JSON.stringify({ isActive: true, acceptedAmount: 70000 })), null)
  assert.equal(recoverySummary(null), null)
  assert.equal(recoverySummary(raw).amount, 70000)
  assert(!JSON.stringify(recoverySummary(raw)).includes('private'))
  assert.equal(recoverySummary('broken').amount, null)
  assert.equal(recoverySummary('broken', JSON.stringify({ isActive: false }), '저장 기록 확인 실패').reason, '저장 기록 확인 실패')
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
  const request = { ...identity, action: 'archive_payment', id: crypto.randomUUID(), fingerprint: fingerprint(raw), confirmed: true, createdAt: 90000, expiresAt: 200000 }
  const job = { request, signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(request)), keys.privateKey).toString('base64') }
  assert(verifyRecoveryCommand(job, raw, identity, 100000, keys.publicKey))
  assert(!verifyRecoveryCommand(job, raw + ' ', identity, 100000, keys.publicKey))
  assert(!verifyRecoveryCommand(job, raw, identity, 100000, keys.publicKey, JSON.stringify({ acceptedAmount: 80000 })), 'unsaved cash changes invalidate an old approval')
  assert(!verifyRecoveryCommand(job, raw, { ...identity, deviceId: 'another-device' }, 100000, keys.publicKey))
  assert(!verifyRecoveryCommand(job, raw, identity, 200000, keys.publicKey))
  assert(!verifyRecoveryCommand({ ...job, request: { ...request, confirmed: false } }, raw, identity, 100000, keys.publicKey))
})
test('reset_device uses the existing signature, exact field order and scoped device', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const request = { id: crypto.randomUUID(), action: 'reset_device', device: 'cardDispenser',
    deviceId: identity.deviceId, property: identity.property, building: identity.building, createdAt: 100000, expiresAt: 220000 }
  const sign = value => ({ request: value, signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(value)), keys.privateKey).toString('base64') })
  assert(verifyRecoveryCommand(sign(request), null, identity, 100001, keys.publicKey))
  for (const changed of [{ ...request, device: 'issue' }, { ...request, deviceId: 'another-device' },
    { ...request, action: 'unknown' }, { ...request, expiresAt: 220001 }, { action: 'reset_device', ...request }])
    assert(!verifyRecoveryCommand(sign(changed), null, identity, 100001, keys.publicKey))
  assert(!verifyRecoveryCommand({ ...sign(request), signature: 'forged' }, null, identity, 100001, keys.publicKey))
  assert(!verifyRecoveryCommand(sign(request), null, identity, 220000, keys.publicKey))
})
test('the one-slot reporter defers busy reset and reports failed/busy after two-minute expiry only once', async () => {
  const fs = require('node:fs'), vm = require('node:vm')
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const request = { id: crypto.randomUUID(), action: 'reset_device', device: 'dispenser',
    deviceId: identity.deviceId, property: identity.property, building: identity.building, createdAt: 100000, expiresAt: 220000 }
  const command = { request, signature: crypto.sign('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(request)), keys.privateKey).toString('base64') }
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

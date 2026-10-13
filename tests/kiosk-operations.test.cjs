const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { recoverySummary, fingerprint, operationsSignature, verifyOperations, verifyRecoveryCommand } = require('../electron/kiosk-operations')
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
  const body = { ...identity, version: 'QA', at: 100000, recovery: recoverySummary(raw), printer: null, result: null }
  const sig = operationsSignature(body, 'test-key')
  assert(verifyOperations(body, sig, 'test-key', identity, 100000))
  assert(!verifyOperations(body, sig, 'wrong-key', identity, 100000))
  assert(!verifyOperations(body, sig, 'test-key', { ...identity, building: 'A' }, 100000))
  assert(!verifyOperations(body, sig, 'test-key', identity, 200000))
  assert(!verifyOperations({ ...body, recovery: { ...body.recovery, amount: -1 } }, sig, 'test-key', identity, 100000))
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
  const body = { ...identity, version: 'QA', at: Date.now(), recovery: recoverySummary(raw), printer: { at: Date.now(), status: 'failed', roomNumber: 'B101', error: 'printer offline' }, result: null }
  const send = (value, signature = operationsSignature(value, key)) => exports.POST(new Request('http://localhost/api/kiosk-operations-agent', {
    method: 'POST', body: JSON.stringify(value), headers: { 'x-kiosk-operations-signature': signature },
  }))
  assert.equal((await send(body, 'bad')).status, 403); assert.equal(writes, 0)
  assert.equal((await send({ ...body, building: 'A' })).status, 403)
  assert.equal((await (await send(body)).json()).command.request.id, id)
  assert.equal(device.printer.error, 'printer offline'); assert.equal(device.recovery.amount, 70000)
  await send({ ...body, result: { id: crypto.randomUUID(), status: 'completed', error: '' } })
  assert.equal(command.status, 'pending')
  assert.equal((await (await send({ ...body, result: { id, status: 'completed', error: '' } })).json()).command, null)
  assert.equal(command.status, 'completed')
})

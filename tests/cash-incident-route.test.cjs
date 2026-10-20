const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { incidentSignature, verifyIncident, incidentFromArchive } = require('../electron/cash-incidents')
const { automaticKind } = require('../electron/payment-recovery')

test('8. automatic archive distinguishes collection from existing booking recovery', () => {
  assert.equal(automaticKind({ pendingBooking: { kind: 'collection' } }), 'collection_unrecorded')
  assert.equal(automaticKind({ pendingBooking: {} }), 'booking_pending')
  assert.equal(automaticKind({ pendingBooking: { kind: 'collection' } }, '{invalid'), 'corrupt')
})

test('9. collection incident carries only validated financial identity and rejects missing or extra fields', () => {
  const key = 'synthetic-incident-key', scope = { property: 'property3', building: 'A' }
  const body = { requestId: 'qa-payment-key', reservationId: 'qa-reservation', amount: 30000, payment: { method: 'CASH' },
    phoneNumber: 'private-phone', password: 'private-password' }
  const record = { archiveId: 'b'.repeat(64), ...scope, reviewedAt: '2026-10-20T00:00:00.000Z',
    incidentKind: 'collection_unrecorded', memorySnapshot: JSON.stringify({ sessionStartTime: 123456,
      acceptedAmount: 40000, acceptedBills: [10000, 10000, 10000, 10000], returnedAmount: 10000, requiredAmount: 40000,
      reservationData: { roomNumber: 'A901', phoneNumber: 'private-phone', password: 'private-password' },
      pendingBooking: { kind: 'collection', body: JSON.stringify(body), lastStatus: 'stale' } }) }
  const incident = incidentFromArchive(record)
  const valid = value => verifyIncident(value, incidentSignature(value, key), key, scope)
  assert.equal(valid(incident), true)
  assert.deepEqual(incident.collection, { reservationId: body.reservationId, amount: 30000, method: '현금',
    paymentKey: body.requestId, pmsStatus: 'stale' })
  assert.equal(incident.requiredAmount, 30000); assert.equal(incident.receivedAmount, 40000)
  assert.equal(incident.confirmedReturnedAmount, 10000)
  assert.equal(incident.reason, '결제 완료·PMS 수금 기록 미확인 (stale)')
  assert.doesNotMatch(JSON.stringify(incident), /phone|password/)
  const missing = { ...incident }; delete missing.collection
  assert.equal(valid(missing), false)
  assert.equal(valid({ ...incident, kind: 'cash' }), false)
  assert.equal(valid({ ...incident, collection: { ...incident.collection, phoneNumber: 'private' } }), false)
  for (const [field, values] of Object.entries({ reservationId: ['', 'a'.repeat(201)], amount: [-1, 1.5, '30000', Number.MAX_SAFE_INTEGER + 1],
    method: ['CARD'], paymentKey: ['', 'a'.repeat(301)], pmsStatus: ['a'.repeat(41), null] })) {
    for (const value of values) assert.equal(valid({ ...incident, collection: { ...incident.collection, [field]: value } }), false)
  }
  for (const serialized of ['invalid-json', '{}', JSON.stringify({ ...body, amount: -1 })]) {
    const corrupt = incidentFromArchive({ ...record, memorySnapshot: JSON.stringify({ pendingBooking: { body: serialized } }) })
    assert.equal(corrupt.kind, 'corrupt'); assert.equal(Object.hasOwn(corrupt, 'collection'), false)
    assert.equal(valid(corrupt), true)
  }
  const card = incidentFromArchive({ ...record, memorySnapshot: JSON.stringify({ pendingBooking: {
    body: JSON.stringify({ ...body, payment: { method: 'CARD' } }), lastStatus: 'error',
  } }) })
  assert.equal(card.collection.method, '카드'); assert.equal(card.receivedAmount, 0)
})

test('incident keeps the original payment timestamp', () => {
  const started = 1789147000000
  const incident = incidentFromArchive({ archiveId: 'b'.repeat(64), property: 'property3', building: 'A',
    reviewedAt: '2026-10-13T00:00:00.000Z', version: '1.3.31', incidentKind: 'cash',
    memorySnapshot: JSON.stringify({ sessionStartTime: started, acceptedAmount: 10000, requiredAmount: 10000 }) })
  assert.equal(incident.occurredAt, started)
})

test('cash incident API requires native signature and device scope, retries idempotently, and fails closed offline', async () => {
  const key = 'synthetic-api-key', records = new Map(), writes = []
  let offline = false
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../app/api/kiosk-payment-incidents/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module.exports, process: { env: { FIREBASE_PRIVATE_KEY: key } }, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } }
    if (name === '@/lib/kiosk-scope') return { getKioskScope: () => ({ property: 'property3', building: 'A' }) }
    if (name === '@/electron/cash-incidents') return { verifyIncident }
    if (name === '@/lib/firebase-admin') return { getDB: () => ({ ref(path) {
      assert.match(path, /^kiosk_payment_incidents\/[a-f0-9]{64}$/)
      return { async transaction(update) { if (offline) throw new Error('offline'); writes.push(path); records.set(path, update(records.get(path))) } }
    } }) }
    throw new Error('Unexpected dependency: ' + name)
  } })
  const incident = { id: 'b'.repeat(64), property: 'property3', building: 'A', roomNumber: 'A901', occurredAt: 1789147000000,
    receivedAmount: 50000, confirmedReturnedAmount: 0, cashRecordedAmount: 50000, requiredAmount: 30000, expectedChange: 20000,
    reason: 'Synthetic change error', status: 'needs_review', bookingCreated: false, refundConfirmed: false }
  const request = (body, signature = incidentSignature(body, key)) => new Request('http://localhost:3000/api/kiosk-payment-incidents', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kiosk-incident-signature': signature }, body: JSON.stringify(body),
  })
  assert.equal((await module.exports.POST(request(incident, 'invalid'))).status, 403)
  assert.equal((await module.exports.POST(request({ ...incident, building: 'B' }))).status, 403)
  assert.equal((await module.exports.POST(request({ ...incident, kind: 'card_number' }))).status, 403)
  assert.equal(writes.length, 0)
  const success = await module.exports.POST(request(incident))
  assert.equal(success.status, 200)
  assert.deepEqual(await success.json(), { success: true, id: incident.id })
  const path = writes[0]
  records.set(path, { ...records.get(path), status: 'operator_reviewed' })
  await module.exports.POST(request(incident))
  assert.equal(records.size, 1)
  assert.equal(records.get(path).status, 'operator_reviewed')
  const cardIncident = { ...incident, id: 'c'.repeat(64), kind: 'card_approval', receivedAmount: 0, cashRecordedAmount: 0, expectedChange: 0 }
  assert.equal((await module.exports.POST(request(cardIncident))).status, 200)
  assert.equal(records.get('kiosk_payment_incidents/' + cardIncident.id).kind, 'card_approval')
  offline = true
  assert.equal((await module.exports.POST(request(incident))).status, 503)
})

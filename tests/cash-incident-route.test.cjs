const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { incidentSignature, verifyIncident } = require('../electron/cash-incidents')

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
  assert.equal(writes.length, 0)
  const success = await module.exports.POST(request(incident))
  assert.equal(success.status, 200)
  assert.deepEqual(await success.json(), { success: true, id: incident.id })
  const path = writes[0]
  records.set(path, { ...records.get(path), status: 'operator_reviewed' })
  await module.exports.POST(request(incident))
  assert.equal(records.size, 1)
  assert.equal(records.get(path).status, 'operator_reviewed')
  offline = true
  assert.equal((await module.exports.POST(request(incident))).status, 503)
})

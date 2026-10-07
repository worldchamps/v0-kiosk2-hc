const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const proof = require('../electron/pms-card-request')
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const env = { KIOSK_PROPERTY_ID: 'property1', KIOSK_DEVICE_ID: 'property1-kiosk-01', CARD_DISPENSER_ENABLED: 'true' }
function envelope(room = 'C103', other = {}) {
  const request = { id: crypto.randomUUID(), room, property: 'property1', deviceId: 'property1-kiosk-01', createdAt: Date.now(), expiresAt: Date.now() + 600000, ...other }
  request.expiresAt = request.createdAt + 600000
  return { request, signature: crypto.sign('sha256', Buffer.from('pms-card-v1:' + JSON.stringify(request)), keys.privateKey).toString('base64') }
}
const verifyRequest = (value, config, now) => proof.verifyRequest(value, config, now, keys.publicKey)
test('PMS card signature binds one room, property, kiosk and ten-minute lifetime', () => {
  const value = envelope()
  assert.equal(verifyRequest(value, env).room, 'C103')
  for (const invalid of [{ ...value, signature: 'forged' }, { ...value, request: { ...value.request, room: 'C105' } }, envelope('B101'),
    envelope('C103', { createdAt: Date.now() - 600001 }), envelope('C103', { createdAt: Date.now() + 60000 })])
    assert.throws(() => verifyRequest(invalid, env))
  assert.throws(() => verifyRequest(value, { ...env, KIOSK_DEVICE_ID: 'another-kiosk' }))
  assert.throws(() => verifyRequest(value, { ...env, KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'A' }))
  const a = envelope('A101', { property: 'property3', deviceId: 'property3-kiosk-01' })
  assert.equal(verifyRequest(a, { ...env, KIOSK_PROPERTY_ID: 'property3', KIOSK_BUILDING: 'A', KIOSK_DEVICE_ID: 'property3-kiosk-01' }).room, 'A101')
})
function serviceFixture() {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/card-key-service.js'), 'utf8'), {
    module, require: name => name === './pms-card-request' ? { verifyRequest } : name.startsWith('.') ? require('../electron/' + name.slice(2)) : require(name),
    URL, setTimeout, clearTimeout, Buffer,
  })
  const records = new Map([['room-C103', { room: 'C103', uid: '01020304' }]]), sent = [], callbacks = new Set()
  const mainFrame = { url: 'http://localhost:3000/' }, event = { senderFrame: mainFrame, sender: { mainFrame, isDestroyed: () => false, send() {} } }
  let hold = false
  const create = () => module.exports.createCardKeyService({ env, token: 'synthetic', timeoutMs: 15,
    store: { read: id => records.get(id), write: (id, value) => records.set(id, structuredClone(value)) },
    authorize: () => { throw Error('Remote signed request must not use administrator password') }, isIdle: () => true, setBusy() {},
    bridge: { isConnected: true, subscribeMessage: fn => { callbacks.add(fn); return () => callbacks.delete(fn) },
      send: value => { sent.push(value); if (!hold) queueMicrotask(() => { for (const callback of callbacks) callback({ requestId: value.requestId, type: 'card_result', success: true, settled: true }) }); return true } },
  })
  return { create, event, sent, records, hold: () => { hold = true } }
}
test('signed remote delivery is UID-only and durable across duplicate requests and restart', async () => {
  const f = serviceFixture(), value = envelope()
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: value })).success, true)
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: value })).success, true)
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].issueMode, 'uid_only')
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: envelope('C105') })).reason, 'room_not_registered')
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: { ...value, signature: 'bad' } })).success, false)
  assert.equal(f.sent.length, 1)
})
test('uncertain remote delivery cannot dispense again after restart', async () => {
  const f = serviceFixture(), value = envelope(); f.hold()
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: value })).settled, false)
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: value })).settled, false)
  assert.equal((await f.create().run(f.event, 'remote_issue', { envelope: envelope() })).reason, 'inspection_required')
  assert.equal(f.sent.length, 1)
})
test('remote queue claims and print transitions reject wrong devices, stale jobs and repeated printing', async () => {
  const valid = envelope(), foreign = envelope('A101', { property: 'property3', deviceId: 'property3-kiosk-01' })
  const rows = { [valid.request.id]: { ...valid, status: 'pending' }, [foreign.request.id]: { ...foreign, status: 'pending' } }
  const exports = {}, deps = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    '@/lib/kiosk-scope': { getKioskScope: () => ({ property: 'property1' }) },
    '@/electron/pms-card-request': { verifyRequest },
    '@/lib/firebase-beach-rooms': { getRoomInfoByMatchingNumber: async () => ({ password: 'hidden-on-C', floor: '1F' }) },
    '@/lib/firebase-admin': { getDB: () => ({ ref: name => { assert.equal(name, 'kiosk_key_jobs/property1'); return {
      limitToLast: () => ({ once: async () => ({ val: () => rows }) }),
      child: id => ({ once: async () => ({ val: () => rows[id] }), transaction: async callback => {
        const next = callback(rows[id]); if (next) rows[id] = next; return { committed: !!next }
      } }),
    } } }) },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/api/remote-key/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => { assert(name in deps, name); return deps[name] }, process: { env }, Date })
  assert.deepEqual((await (await exports.GET()).json()).jobs, [valid.request.id])
  const post = action => exports.POST({ json: async () => ({ id: valid.request.id, action }) })
  const claim = await (await post('claim')).json()
  assert.equal(claim.receipt.password, '')
  assert.equal((await post('complete')).status, 409)
  assert.equal((await post('printing')).status, 200)
  assert.equal((await post('printing')).status, 409)
  assert.deepEqual((await (await exports.GET()).json()).jobs, [])
  assert.equal((await post('complete')).status, 200)
  assert.equal((await post('claim')).status, 409)
})

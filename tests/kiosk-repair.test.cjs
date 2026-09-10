const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { prepare, apply, encrypt, decrypt } = require('../ops/repair/property3-a.cjs')

test('A repair preserves all settings and encrypted backups; rejects unsafe inputs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-repair-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const key = crypto.randomBytes(32), state = Buffer.from('synthetic-local-state')
  const stateHash = crypto.createHash('sha256').update(state).digest('hex')
  const file = path.join(dir, 'kiosk-device.bin')
  fs.writeFileSync(path.join(dir, 'Local State'), state)
  const original = { projectId: 'beachstay-kiosk-updates', property: 'property3', deviceId: 'qa-a', registered: true, arch: process.arch,
    auth: { uid: 'synthetic-uid', refreshToken: 'synthetic-not-a-real-token' },
    env: { KIOSK_PROPERTY_ID: 'property3', PRINTER_NAME: '테스트 "프린터"', COM_PORT: 'COM9', PRICE: '90000', MULTILINE: 'a\nb' },
    unknown: { keep: [null, false, 3.5, '🍀'], number: 9007199254740991 } }
  const write = config => fs.writeFileSync(file, encrypt(JSON.stringify(config), key))
  write(original)
  const bytes = fs.readFileSync(file)
  const plan = prepare(dir, key, stateHash)
  const result = apply(plan)
  assert.equal(result.changed, true)
  const updated = JSON.parse(decrypt(fs.readFileSync(file), key))
  assert.equal(updated.env.KIOSK_BUILDING, 'A')
  delete updated.env.KIOSK_BUILDING
  assert.deepEqual(updated, original)
  assert.deepEqual(fs.readFileSync(path.join(dir, result.backup, 'kiosk-device.bin')), bytes)
  assert.deepEqual(fs.readFileSync(path.join(dir, result.backup, 'Local State')), state)
  assert.deepEqual(fs.readFileSync(path.join(dir, 'Local State')), state)
  const already = prepare(dir, key, stateHash)
  assert.deepEqual(apply(already), { changed: false })
  assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('A-repair-backup-')).length, 1)
  for (const change of [c => c.property = 'property1', c => c.registered = false, c => delete c.auth,
    c => c.env.KIOSK_BUILDING = 'B', c => c.env.KIOSK_BUILDING = ' b ', c => c.env = [],
    c => c.env.KIOSK_PROPERTY_ID = 'property4', c => c.arch = 'arm64', c => c.deviceId = '../bad']) {
    const config = structuredClone(original); change(config); write(config)
    const before = fs.readFileSync(file)
    assert.throws(() => prepare(dir, key, stateHash))
    assert.deepEqual(fs.readFileSync(file), before)
  }
  write(original)
  assert.throws(() => prepare(dir, crypto.randomBytes(32), stateHash))
  assert.throws(() => prepare(dir, key, 'changed-state'))
  const stale = prepare(dir, key, stateHash)
  write({ ...original, unknown: 'changed-concurrently' })
  const concurrent = fs.readFileSync(file)
  assert.throws(() => apply(stale))
  assert.deepEqual(fs.readFileSync(file), concurrent)
  write(original)
  const stateStale = prepare(dir, key, stateHash)
  fs.writeFileSync(path.join(dir, 'Local State'), 'changed')
  assert.throws(() => apply(stateStale))
  fs.writeFileSync(file, Buffer.from('corrupt'))
  assert.throws(() => decrypt(fs.readFileSync(file), key))
})

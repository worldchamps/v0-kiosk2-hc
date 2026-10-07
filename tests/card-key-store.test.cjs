const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { createCardKeyStore } = require('../electron/card-key-store')

test('card store writes only ciphertext and returns only room/date metadata', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'k750-store-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const key = crypto.randomBytes(32)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(value) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
  const store = createCardKeyStore({ directory, safeStorage })
  const record = { room: 'A101', registeredAt: '2026-10-07T00:00:00.000Z', blocks: { 1: 'a1'.repeat(16) } }
  store.write('room-A101', record)
  assert.deepEqual(store.read('room-A101'), record)
  assert.deepEqual(store.list(), [{ room: 'A101', registeredAt: record.registeredAt }])
  assert.equal(fs.readFileSync(path.join(directory, 'room-A101.bin')).includes(Buffer.from(record.blocks[1])), false)
  assert.deepEqual(fs.readdirSync(directory), ['room-A101.bin'])
  const replacement = { ...record, registeredAt: '2026-10-07T01:00:00.000Z' }
  store.write('room-A101', replacement)
  assert.deepEqual(store.read('room-A101'), replacement)
  assert.throws(() => store.write('../escape', record))
  safeStorage.isEncryptionAvailable = () => false
  assert.throws(() => store.write('room-A101', record), /encryption_unavailable/)
  safeStorage.isEncryptionAvailable = () => true
  safeStorage.encryptString = () => Buffer.from('BROKEN')
  assert.throws(() => store.write('room-A101', record))
  assert.deepEqual(store.read('room-A101'), replacement)
  assert.deepEqual(fs.readdirSync(directory), ['room-A101.bin'])
})

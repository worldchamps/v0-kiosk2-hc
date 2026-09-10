// Synthetic isolated profile only. Never start the kiosk bootstrap or connect to services.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const dir = process.env.KIOSK_REPAIR_TEST_DIR
assert.ok(dir && path.basename(dir).startsWith('kiosk-repair-interop-'))
app.setPath('userData', dir)
app.disableHardwareAcceleration()
app.whenReady().then(() => {
  assert.equal(process.versions.electron, '28.3.3')
  const file = path.join(dir, 'kiosk-device.bin')
  const original = { projectId: 'beachstay-kiosk-updates', property: 'property3', deviceId: 'qa-synthetic-a', registered: true,
    arch: process.env.KIOSK_REPAIR_TEST_ARCH,
    auth: { uid: 'synthetic-uid', refreshToken: 'synthetic-token-not-valid' },
    env: { KIOSK_PROPERTY_ID: 'property3', PRINTER_NAME: '한글 프린터', TOSS_TERMINAL: 'synthetic', MULTILINE: 'one\ntwo' },
    extra: { nested: [null, 123, false, 'keep'] } }
  if (process.env.KIOSK_REPAIR_TEST_VERIFY === '1') {
    const repaired = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
    assert.equal(repaired.env.KIOSK_BUILDING, 'A')
    delete repaired.env.KIOSK_BUILDING
    assert.deepEqual(repaired, original)
    const backup = fs.readdirSync(dir).find(n => n.startsWith('A-repair-backup-'))
    assert.deepEqual(JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(dir, backup, 'kiosk-device.bin')))), original)
    fs.writeFileSync(path.join(dir, 'verified.txt'), 'ELECTRON_SAFE_STORAGE_ROUNDTRIP_PASS')
  } else {
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(original)))
  }
  app.quit()
}).catch(() => app.exit(1))

// Electron 28 Windows safeStorage: v10 + nonce(12) + AES-256-GCM + tag(16).
// The launcher unwraps the profile key using Windows CurrentUser DPAPI.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

class RepairError extends Error {}
function check(ok, message) { if (!ok) throw new RepairError(message) }
function read(file) {
  const stat = fs.lstatSync(file)
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size < 2 * 1024 * 1024, '설정 파일 형식을 확인해 주세요.')
  return fs.readFileSync(file)
}
function decrypt(data, key) {
  check(key.length === 32 && data.length > 31 && data.subarray(0, 3).toString() === 'v10', '지원하지 않는 암호화 형식입니다.')
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(3, 15))
  cipher.setAuthTag(data.subarray(-16))
  return Buffer.concat([cipher.update(data.subarray(15, -16)), cipher.final()]).toString('utf8')
}
function encrypt(text, key) {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  return Buffer.concat([Buffer.from('v10'), nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()])
}
function prepare(dir, key, stateHash) {
  check(!fs.lstatSync(dir).isSymbolicLink(), '연결된 설정 폴더는 복구하지 않습니다.')
  const file = path.join(dir, 'kiosk-device.bin')
  const stateFile = path.join(dir, 'Local State')
  const state = read(stateFile)
  check(crypto.createHash('sha256').update(state).digest('hex') === stateHash, '설정이 변경되었습니다. 키오스크를 종료한 뒤 다시 실행해 주세요.')
  const original = read(file)
  const config = JSON.parse(decrypt(original, key))
  check(config.projectId === 'beachstay-kiosk-updates' && config.property === 'property3' && config.registered === true, '등록된 property3 키오스크만 복구할 수 있습니다.')
  check(typeof config.deviceId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(config.deviceId), '장비 등록 정보를 확인해 주세요.')
  check(['ia32', 'x64'].includes(config.arch || 'x64') && (config.arch || 'x64') === process.arch, '설치 프로그램과 장비 설정의 비트수가 다릅니다.')
  check(config.auth && typeof config.auth.uid === 'string' && config.auth.uid && typeof config.auth.refreshToken === 'string' && config.auth.refreshToken, '기존 장비 인증 정보가 없습니다. 재등록하지 말고 관리자에게 문의해 주세요.')
  check(config.env && typeof config.env === 'object' && !Array.isArray(config.env), 'PC 설정 형식이 올바르지 않습니다.')
  for (const name of ['KIOSK_PROPERTY_ID', 'NEXT_PUBLIC_KIOSK_PROPERTY_ID']) {
    check(!config.env[name] || config.env[name] === 'property3', '저장된 숙소 설정이 서로 다릅니다.')
  }
  const building = config.env.KIOSK_BUILDING
  check(typeof building === 'undefined' || typeof building === 'string', '동 설정 형식이 올바르지 않습니다.')
  check(String(building || '').trim().toUpperCase() !== 'B', 'B동으로 지정된 PC입니다. A동 복구를 중단합니다.')
  const repaired = JSON.parse(JSON.stringify(config))
  repaired.env.KIOSK_BUILDING = 'A'
  const updated = encrypt(JSON.stringify(repaired), key)
  assert.deepEqual(JSON.parse(decrypt(updated, key)), repaired)
  return { dir, file, stateFile, state, original, updated, deviceId: config.deviceId, alreadyA: building === 'A' }
}
function apply(plan) {
  check(read(plan.file).equals(plan.original) && read(plan.stateFile).equals(plan.state), '설정이 변경되었습니다. 키오스크를 종료한 뒤 다시 실행해 주세요.')
  if (plan.alreadyA) return { changed: false }
  const backup = fs.mkdtempSync(path.join(plan.dir, 'A-repair-backup-'))
  fs.writeFileSync(path.join(backup, 'kiosk-device.bin'), plan.original, { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(path.join(backup, 'Local State'), plan.state, { flag: 'wx', mode: 0o600 })
  check(read(path.join(backup, 'kiosk-device.bin')).equals(plan.original) && read(path.join(backup, 'Local State')).equals(plan.state), '백업 검사에 실패했습니다. 원본은 변경하지 않았습니다.')
  const temp = path.join(backup, 'repaired.tmp')
  const fd = fs.openSync(temp, 'wx', 0o600)
  try { fs.writeFileSync(fd, plan.updated); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  check(read(plan.file).equals(plan.original) && read(plan.stateFile).equals(plan.state), '설정이 변경되어 복구를 중단했습니다. 백업은 보존했습니다.')
  fs.renameSync(temp, plan.file)
  check(read(plan.file).equals(plan.updated), '저장 확인에 실패했습니다. 백업을 보존하고 관리자에게 문의해 주세요.')
  return { changed: true, backup: path.basename(backup) }
}
async function run() {
  const lines = require('node:readline').createInterface({ input: process.stdin })[Symbol.asyncIterator]()
  const input = JSON.parse((await lines.next()).value)
  const key = Buffer.from(input.key, 'base64')
  try {
    check(process.versions.electron === '28.3.3', '이 복구파일은 키오스크 1.3.2 / Electron 28.3.3용입니다.')
    const plan = prepare(input.dir, key, input.stateHash)
    process.stdout.write(JSON.stringify({ deviceId: plan.deviceId, alreadyA: plan.alreadyA }) + '\n')
    if ((await lines.next()).value !== 'CONFIRM_PROPERTY3_A_IDLE') return
    process.stdout.write(JSON.stringify(apply(plan)) + '\n')
  } finally { key.fill(0) }
}
if (process.argv.includes('--repair')) run().catch(error => {
  // Never serialize raw exceptions: parser/crypto/path errors can contain secrets.
  process.stdout.write(JSON.stringify({ error: error instanceof RepairError ? error.message : '복구를 완료하지 못했습니다. 키오스크를 실행하지 말고 이 화면을 관리자에게 보여 주세요. 기존 백업이 있으면 보존해 주세요.' }) + '\n')
  process.exitCode = 1
}).finally(() => process.exit(process.exitCode || 0))
module.exports = { prepare, apply, encrypt, decrypt }

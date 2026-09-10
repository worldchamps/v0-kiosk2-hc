const crypto = require("node:crypto")

const APP_ID = "com.thebeachstay.kiosk"
const ID = /^[a-zA-Z0-9_-]{8,80}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex")
function check(condition, message) { if (!condition) throw new Error(message) }
function checkArch(arch) {
  check(arch === "x64" || arch === "ia32", "지원하지 않는 아키텍처 (x64 또는 ia32 필요)")
  return arch
}
function releaseTag(version, arch = "x64") {
  check(VERSION.test(version || ""), "정식 버전 번호가 필요합니다.")
  return "v" + version + (checkArch(arch) === "ia32" ? "-ia32" : "")
}
function httpsBase(value) {
  const url = new URL(value)
  check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "HTTPS 서버 주소가 필요합니다.")
  return url.href.replace(/\/$/, "")
}
function sign(payload, key) {
  const bytes = Buffer.from(JSON.stringify(payload))
  return { payload: bytes.toString("base64"), signature: crypto.sign(null, bytes, key).toString("base64") }
}
function verify(envelope, key) {
  check(typeof envelope?.payload === "string" && envelope.payload.length < 16384, "잘못된 배포 정보")
  const bytes = Buffer.from(envelope.payload, "base64")
  check(crypto.verify(null, bytes, key, Buffer.from(envelope.signature || "", "base64")), "배포 서명이 일치하지 않습니다.")
  return JSON.parse(bytes.toString("utf8"))
}
function releaseOf(envelope, key, arch = process.arch) {
  const release = verify(envelope, key)
  check(release.appId === APP_ID && VERSION.test(release.version) && release.platform === "win32" && release.arch === checkArch(arch), "지원하지 않는 설치파일 아키텍처/버전")
  check(/^[A-Za-z0-9+/]{86}==$/.test(release.sha512) && Number.isSafeInteger(release.size) && release.size > 0, "설치파일 해시/크기 오류")
  return release
}
function requestOf(envelope, key, deviceId, now = Date.now()) {
  const request = verify(envelope, key)
  check(request.appId === APP_ID && request.action === "install" && request.deviceId === deviceId && ID.test(request.id), "다른 장비의 업데이트 요청")
  check(VERSION.test(request.version) && VERSION.test(request.fromVersion), "잘못된 대상 버전")
  check(Number.isFinite(request.expiresAt) && request.expiresAt > now && request.createdAt <= now + 60000, "만료된 업데이트 요청")
  return request
}
function newer(next, current) {
  check(VERSION.test(next) && VERSION.test(current), "정식 버전 번호가 필요합니다.")
  const a = next.split(".").map(Number), b = current.split(".").map(Number)
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] }
  return false
}
function safeToInstall(status, now = Date.now()) {
  return status?.safe === true && Number.isFinite(status.at) && Number.isFinite(status.lastActivity) &&
    status.at <= now && now - status.at < 10000 && now - status.lastActivity >= 60000
}
module.exports = { APP_ID, ID, VERSION, digest, check, checkArch, releaseTag, httpsBase, sign, verify, releaseOf, requestOf, newer, safeToInstall }

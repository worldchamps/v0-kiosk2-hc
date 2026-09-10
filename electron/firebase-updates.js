const { check, ID } = require("./update-protocol")
const cloud = require("./update-cloud.json")

async function jsonRequest(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw Object.assign(new Error("장비 연결 요청 오류 (" + response.status + ")"), { status: response.status })
  const text = await response.text()
  check(text.length < 65536, "업데이트 응답이 너무 큽니다.")
  try { return JSON.parse(text) }
  catch { throw new Error("장비 연결 응답 형식이 올바르지 않습니다.") }
}
function createDeviceConnection(config, persist, fetcher = fetch) {
  check(ID.test(config.deviceId), "잘못된 장비 ID")
  let idToken = null, expiresAt = 0
  const post = (url, body) => jsonRequest(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, fetcher)
  async function authenticate() {
    if (idToken && expiresAt > Date.now() + 60000) return idToken
    const result = config.auth
      ? await post("https://securetoken.googleapis.com/v1/token?key=" + cloud.apiKey, { grant_type: "refresh_token", refresh_token: config.auth.refreshToken })
      : await post("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + cloud.apiKey, { returnSecureToken: true })
    const uid = result.user_id || result.localId
    check(uid && (!config.auth || config.auth.uid === uid), "장비 인증이 일치하지 않습니다.")
    config.auth = { uid, refreshToken: result.refresh_token || result.refreshToken }
    check(config.auth.refreshToken, "장비 인증을 저장할 수 없습니다.")
    persist(config) // save BEFORE claiming; retry remains the same physical device
    idToken = result.id_token || result.idToken
    expiresAt = Date.now() + Number(result.expires_in || result.expiresIn) * 1000
    return idToken
  }
  async function access(key, method = "GET", body) {
    check(/^[a-zA-Z0-9_/-]+$/.test(key), "잘못된 장비 경로")
    const token = await authenticate()
    return jsonRequest(cloud.databaseURL + "/" + key + ".json?auth=" + encodeURIComponent(token), {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }, fetcher)
  }
  async function pair() {
    check(config.projectId === cloud.projectId && /^[a-f0-9]{32}$/.test(config.code || ""), "잘못된 등록 파일")
    await authenticate()
    const key = "bindings/" + config.deviceId
    // A successful claim whose response was lost can be retried after expiry.
    let binding
    try { binding = await access(key) } catch (error) { if (![401, 403].includes(error.status)) throw error }
    if (!binding) binding = await access(key, "PUT", { uid: config.auth.uid, property: config.property, code: config.code })
    check(binding.uid === config.auth.uid && binding.property === config.property, "이미 다른 장비에 등록되었거나 등록 정보가 다릅니다.")
    return binding
  }
  async function pollStatus(state) {
    const report = { version: state.version, state: state.state, lastSeen: { ".sv": "timestamp" } }
    if (state.requestId) report.requestId = state.requestId
    if (state.message) report.message = String(state.message).replace(/https?:[\\/]+\S+/g, "[주소 숨김]").slice(0, 250)
    await access("status/" + config.deviceId, "PUT", report)
    return (await access("requests/" + config.deviceId)) || { request: null }
  }
  return { pair, pollStatus, access }
}
module.exports = { createDeviceConnection, jsonRequest }

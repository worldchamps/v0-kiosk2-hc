const fs = require("node:fs")
const { check, releaseOf, requestOf, newer } = require("./update-protocol")
const safeError = (error) => String(error.message).replace(/https?:\/\/\S+/g, "[주소 숨김]").slice(0, 250)

// No update discovery on launch/quit: only an explicit signed device request.
function createKioskUpdater({ deviceId, publicKey, version, stateFile, pollStatus, createUpdater, prepare, resume, shutdown, ready, recover = () => {}, arch = process.arch }) {
  let running = false, exiting = false, shutdownStarted = false, downloaded = null, state = { state: "online" }
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, "utf8"))
  const save = (value) => {
    state = value
    fs.writeFileSync(stateFile + ".tmp", JSON.stringify(value), { mode: 0o600 })
    fs.renameSync(stateFile + ".tmp", stateFile)
  }
  const poll = () => pollStatus({ version, ...state })
  async function tick() {
    if (running || exiting) return
    running = true
    try {
      if (state.state === "installing") {
        if (version === state.targetVersion) {
          if (!ready()) return // version alone is not proof that the kiosk UI started
          save({ ...state, state: "completed", message: "" })
        } else save({ ...state, state: "failed", message: "새 버전으로 재시작되지 않았습니다. 현장 확인 후 새 요청이 필요합니다." })
      }
      // An offline kiosk waits without consuming/failing its pending request.
      let received
      try { received = await poll() } catch { return }
      if (!received.request) { downloaded = null; return }
      let command
      try { command = requestOf(received.request, publicKey, deviceId) } catch { downloaded = null; return }
      if (state.requestId === command.id && ["completed", "failed"].includes(state.state)) return
      if (state.requestId !== command.id) save({ state: "validating", requestId: command.id, targetVersion: command.version })
      check(command.fromVersion === version && newer(command.version, version), "현재 버전과 배포 요청이 일치하지 않습니다.")
      const release = releaseOf(received.release, publicKey, arch)
      check(!command.arch || command.arch === arch, "다른 아키텍처의 업데이트 요청입니다.")
      check(release.version === command.version, "배포 버전 불일치")
      if (downloaded?.id !== command.id) {
        save({ state: "downloading", requestId: command.id, targetVersion: command.version })
        await poll()
        const updater = createUpdater({ command, release })
        updater.logger = null // private, expiring download URLs must not reach logs
        updater.autoDownload = false
        updater.autoInstallOnAppQuit = false
        updater.allowDowngrade = false
        updater.disableDifferentialDownload = true
        updater.on("error", (error) => {
          if (!exiting) return // awaited download/check calls handle these errors
          exiting = false
          save({ ...state, state: "failed", message: safeError(error) })
          resume()
          poll().catch(() => {}).finally(recover)
        })
        const result = await updater.checkForUpdates()
        const info = result?.updateInfo
        check(info?.version === release.version && info.files?.length === 1 &&
          info.files[0].sha512 === release.sha512 && info.files[0].size === release.size, "서명된 파일과 다운로드 정보가 다릅니다.")
        await updater.downloadUpdate()
        downloaded = { id: command.id, updater }
        save({ state: "waiting-idle", requestId: command.id, targetVersion: command.version })
      }
      if (!(await prepare())) return
      try {
        // Revalidate after download and AFTER locking out new guest activity.
        const latest = await poll()
        const confirmed = requestOf(latest.request, publicKey, deviceId)
        check(confirmed.id === command.id, "요청이 취소되거나 변경되었습니다.")
        save({ state: "installing", requestId: command.id, targetVersion: command.version })
        await poll()
        shutdownStarted = true
        await shutdown()
        exiting = true
        downloaded.updater.quitAndInstall(true, true)
      } catch (error) { exiting = false; resume(); throw error }
    } catch (error) {
      if (state.requestId) {
        save({ ...state, state: "failed", message: safeError(error) })
        await poll().catch(() => {})
      }
      if (shutdownStarted) recover()
      // Network failure before a request is received does not stop the kiosk.
    } finally { running = false }
  }
  return { tick, status: () => ({ version, ...state }) }
}
module.exports = { createKioskUpdater }

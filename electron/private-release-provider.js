const { Provider } = require("electron-updater/out/providers/Provider")
const { check } = require("./update-protocol")

function downloadUrl(command, now = Date.now()) {
  const url = new URL(command.downloadUrl)
  check(url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    ["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname), "허용하지 않은 다운로드 주소")
  check(Number.isFinite(command.downloadExpiresAt) && command.downloadExpiresAt > now + 30000, "다운로드 주소가 만료되었습니다. 새 업데이트 요청이 필요합니다.")
  return url
}
// Signed manifest in Firebase; no GitHub API token or public latest.yml on PCs.
class PrivateReleaseProvider extends Provider {
  constructor(options, _updater, runtimeOptions) {
    super({ ...runtimeOptions, isUseMultipleRangeRequest: false })
    this.url = downloadUrl(options.command)
    this.info = { version: options.release.version, files: [{
      url: this.url.href, sha512: options.release.sha512, size: options.release.size,
    }] }
  }
  async getLatestVersion() { return this.info }
  resolveFiles() { return [{ url: this.url, info: this.info.files[0] }] }
}
module.exports = { PrivateReleaseProvider, downloadUrl }

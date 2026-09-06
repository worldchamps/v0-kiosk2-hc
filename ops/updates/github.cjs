const fs = require("node:fs")
const crypto = require("node:crypto")
const { cliToken } = require("./admin.cjs")
const { check, sign } = require("../../electron/update-protocol")
const { downloadUrl } = require("../../electron/private-release-provider")

async function github(repo, suffix = "", method = "GET", body) {
  check(repo === "worldchamps/kiosk-private-releases", "Use the dedicated private release repository")
  const response = await fetch("https://api.github.com/repos/" + repo + suffix, {
    method, headers: { Authorization: "Bearer " + cliToken("github"), Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw Object.assign(new Error("GitHub request rejected (" + response.status + ")"), { status: response.status })
  return response.json()
}
async function privateRepo(repo) { check((await github(repo)).private === true, "Release repository must remain PRIVATE") }
async function publishInstaller(config, file, version, privateKey) {
  const repo = config.githubRepo
  await privateRepo(repo)
  const tag = "v" + version
  let existing
  try { existing = await github(repo, "/releases/tags/" + tag) } catch (error) { if (error.status !== 404) throw error }
  check(!existing, "Release version already exists; do not overwrite an installer")
  const sha512 = crypto.createHash("sha512"), sha256 = crypto.createHash("sha256")
  for await (const chunk of fs.createReadStream(file)) { sha512.update(chunk); sha256.update(chunk) }
  const size = fs.statSync(file).size
  check(size > 0 && size < 2 * 1024 ** 3, "Installer must be below 2 GiB")
  const draft = await github(repo, "/releases", "POST", { tag_name: tag, name: "Kiosk " + version, draft: true, body: "Private installer. Publishing does not request an update on any device." })
  const url = new URL(draft.upload_url.split("{")[0])
  check(url.origin === "https://uploads.github.com", "Unexpected upload host")
  async function upload(name, body, length, contentType) {
    url.search = new URLSearchParams({ name }).toString()
    const response = await fetch(url, { method: "POST", redirect: "error", duplex: "half",
      headers: { Authorization: "Bearer " + cliToken("github"), "Content-Type": contentType, "Content-Length": String(length) },
      body, signal: AbortSignal.timeout(15 * 60000),
    })
    check(response.ok, "Private release upload failed; inspect the draft before retrying")
    return response.json()
  }
  const asset = await upload("installer.exe", fs.createReadStream(file), size, "application/octet-stream")
  const expected256 = "sha256:" + sha256.digest("hex")
  check(asset.size === size && asset.digest === expected256, "GitHub uploaded file verification failed")
  const signed = sign({ appId: "com.thebeachstay.kiosk", platform: "win32", arch: "x64", version,
    sha512: sha512.digest("base64"), size, createdAt: Date.now(), repository: repo, assetId: asset.id }, privateKey)
  const metadata = Buffer.from(JSON.stringify(signed))
  await upload("release.json", metadata, metadata.length, "application/json")
  await privateRepo(repo)
  await github(repo, "/releases/" + draft.id, "PATCH", { draft: false })
  return signed
}
async function downloadTicket(config, release) {
  await privateRepo(config.githubRepo)
  check(release.repository === config.githubRepo && Number.isSafeInteger(release.assetId), "Invalid private release")
  const response = await fetch("https://api.github.com/repos/" + config.githubRepo + "/releases/assets/" + release.assetId + "?nonce=" + Date.now(), {
    headers: { Authorization: "Bearer " + cliToken("github"), Accept: "application/octet-stream" },
    redirect: "manual", signal: AbortSignal.timeout(30000),
  })
  check(response.status === 302, "GitHub did not provide a temporary download URL")
  const url = new URL(response.headers.get("location"))
  const expiry = Date.parse(url.searchParams.get("se"))
  const ticket = { downloadUrl: url.href, downloadExpiresAt: Math.min(expiry, Date.now() + 3600000) }
  downloadUrl(ticket) // strict GitHub asset host + expiry; never print this URL
  await response.body?.cancel()
  return ticket
}
module.exports = { github, privateRepo, publishInstaller, downloadTicket }

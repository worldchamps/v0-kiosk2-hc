const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { check } = require("../../electron/update-protocol")

// Deployment workstation only. CLI credentials never go to installers/devices.
function cliToken(kind) {
  const options = { encoding: "utf8", windowsHide: true }
  const result = kind === "github"
    ? spawnSync(process.env.GH_BIN || "C:/Program Files/GitHub CLI/gh.exe", ["auth", "token"], options)
    : spawnSync('"C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd" auth print-access-token --quiet', { ...options, shell: true })
  check(result.status === 0 && result.stdout.trim(), kind + " CLI login required")
  return result.stdout.trim()
}
async function cloudFetch(url, method = "GET", body, extraHeaders = {}) {
  const parsed = new URL(url)
  check(parsed.protocol === "https:" && (parsed.hostname.endsWith(".googleapis.com") ||
    parsed.hostname.endsWith(".firebasedatabase.app")), "Unsupported cloud endpoint")
  const response = await fetch(url, {
    method, headers: { Authorization: "Bearer " + cliToken("google"), "x-goog-user-project": "beachstay-kiosk-updates", "Content-Type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) {
    // Only sanitized API status codes; never echo request URLs, tokens or bodies.
    const error = await response.json().catch(() => ({}))
    throw Object.assign(new Error("Cloud request rejected (" + response.status + "): " + String(error.error?.message || error.error?.status || "check project permissions/configuration").replace(/https?:\/\/\S+/g, "[endpoint]")),
      { status: response.status })
  }
  return response
}
function loadConfig(file = path.join(__dirname, "../../electron/update-cloud.json")) {
  const config = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))
  check(config.projectId === "beachstay-kiosk-updates" &&
    config.databaseURL === "https://beachstay-kiosk-updates-default-rtdb.asia-southeast1.firebasedatabase.app" &&
    config.githubRepo === "worldchamps/kiosk-private-releases" && typeof config.apiKey === "string", "Unexpected update-only project configuration")
  return config
}
function database(config) {
  const url = (key) => {
    check(/^[a-zA-Z0-9_/-]+$/.test(key), "Invalid database path")
    return config.databaseURL + "/" + key + ".json"
  }
  return {
    async get(key) {
      const response = await cloudFetch(url(key), "GET", undefined, { "X-Firebase-ETag": "true" })
      return { value: await response.json(), generation: response.headers.get("etag") }
    },
    async put(key, value, generation) {
      check(generation, "A conditional write is required")
      await cloudFetch(url(key), "PUT", value, { "if-match": generation })
    },
  }
}
module.exports = { cliToken, cloudFetch, loadConfig, database }

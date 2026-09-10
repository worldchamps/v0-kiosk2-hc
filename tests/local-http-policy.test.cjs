const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const { allowLocalRequest } = require("../electron/local-http-policy")

test("plain-text JSON is parseable but cross-site requests cannot reach a mutation", async t => {
  // request.json() is not a Content-Type or CSRF check.
  assert.deepEqual(await new Request("http://localhost/api/on-site-booking", {
    method: "POST", headers: { "content-type": "text/plain" }, body: '{"paymentMethod":"cash"}',
  }).json(), { paymentMethod: "cash" })
  let writes = 0
  const server = http.createServer((req, res) => {
    res.statusCode = allowLocalRequest(req) ? 200 : 403
    if (res.statusCode === 200) writes++
    req.resume(); res.end()
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = headers => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port,
      path: "/api/on-site-booking", method: "POST", headers: { host: "localhost:3000", ...headers },
    }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)) })
    req.on("error", reject)
    req.end('{"paymentMethod":"cash"}')
  })
  for (const headers of [
    { origin: "https://example.test", "content-type": "text/plain" },
    { origin: "null", "content-type": "application/json" },
    { host: "rebound.example:3000", "content-type": "application/json" },
    { "sec-fetch-site": "cross-site", "content-type": "application/json" },
    { "content-type": "text/plain" },
  ]) assert.equal(await request(headers), 403)
  assert.equal(writes, 0)
  assert.equal(await request({ origin: "http://localhost:3000", "content-type": "application/json; charset=utf-8" }), 200)
  assert.equal(await request({ "x-api-key": "synthetic-key", "content-type": "application/json" }), 200)
  assert.equal(writes, 2)
})

test("loopback aliases preserve same-origin UI and native read requests", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])
    assert.equal(allowLocalRequest({ headers: { host }, method: "GET", url: "/" }), true)
  assert.equal(allowLocalRequest({ headers: {}, method: "GET", url: "/" }), false)
  assert.equal(allowLocalRequest({ headers: { host: "localhost:3000", origin: "http://localhost:3214" }, method: "GET", url: "/" }), false)
})

test("the packaged server applies the policy before Next or operation accounting", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm")
  const { EventEmitter } = require("node:events")
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8")
  const start = source.indexOf("nextServer = http.createServer((req, res) => {")
  const end = source.indexOf("\n  await new Promise", start)
  assert.ok(start > 0 && end > start)
  let handler, nextCalls = 0
  const global = {}
  vm.runInNewContext(source.slice(start, end), {
    global, allowLocalRequest, http: { createServer: fn => { handler = fn } },
    handle: (_req, res) => { nextCalls++; res.end() },
  })
  const response = () => Object.assign(new EventEmitter(), { writeHead(status) { this.status = status }, end() { this.emit("finish") } })
  const rejected = response()
  handler({ method: "POST", url: "/api/on-site-booking", headers: { host: "localhost:3000", origin: "https://example.test", "content-type": "text/plain" } }, rejected)
  assert.equal(rejected.status, 403)
  assert.equal(nextCalls, 0)
  assert.equal(global.kioskHttpActive, undefined)
  handler({ method: "GET", url: "/api/kiosk-config", headers: { host: "localhost:3000" } }, response())
  assert.equal(nextCalls, 1)
  assert.equal(global.kioskHttpActive, 0)
})

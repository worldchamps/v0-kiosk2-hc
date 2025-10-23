const { createServer } = require("http")
const { parse } = require("url")
const next = require("next")
const path = require("path")

let nextApp = null
let server = null

async function startNextServer(port = 3000) {
  const dev = false
  const hostname = "localhost"

  const app = next({
    dev,
    hostname,
    port,
    dir: path.join(__dirname, ".."),
  })

  const handle = app.getRequestHandler()

  try {
    await app.prepare()
    console.log("[v0] Next.js server prepared")

    server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true)
        await handle(req, res, parsedUrl)
      } catch (err) {
        console.error("[v0] Error handling request:", err)
        res.statusCode = 500
        res.end("Internal server error")
      }
    })

    await new Promise((resolve, reject) => {
      server.listen(port, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    console.log(`[v0] Next.js server started on http://${hostname}:${port}`)
    nextApp = app
    return `http://${hostname}:${port}`
  } catch (error) {
    console.error("[v0] Failed to start Next.js server:", error)
    throw error
  }
}

function stopNextServer() {
  if (server) {
    server.close()
    console.log("[v0] Next.js server stopped")
  }
}

module.exports = { startNextServer, stopNextServer }

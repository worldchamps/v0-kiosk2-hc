const { createServer } = require("http")
const { parse } = require("url")
const next = require("next")
const path = require("path")

let nextApp = null
let server = null

async function startNextServer(port = 3000) {
  const dev = false
  const hostname = "localhost"
  const maxRetries = 3
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      console.log(`[v0] Starting Next.js server (attempt ${retryCount + 1}/${maxRetries})...`)

      const app = next({
        dev,
        hostname,
        port,
        dir: path.join(__dirname, ".."),
      })

      const handle = app.getRequestHandler()

      console.log("[v0] Preparing Next.js app...")
      await app.prepare()
      console.log("[v0] Next.js app prepared successfully")

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
        server.on("error", reject)
        server.listen(port, hostname, () => {
          console.log(`[v0] Server listening on http://${hostname}:${port}`)
          resolve()
        })
      })

      console.log(`[v0] Next.js server started successfully on http://${hostname}:${port}`)
      nextApp = app
      return `http://${hostname}:${port}`
    } catch (error) {
      retryCount++
      console.error(`[v0] Failed to start Next.js server (attempt ${retryCount}/${maxRetries}):`, error.message)

      if (server) {
        try {
          server.close()
        } catch (e) {
          // Ignore close errors
        }
      }

      if (retryCount < maxRetries) {
        console.log(`[v0] Retrying in 2 seconds...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      } else {
        throw new Error(`Failed to start Next.js server after ${maxRetries} attempts: ${error.message}`)
      }
    }
  }
}

function stopNextServer() {
  if (server) {
    server.close()
    console.log("[v0] Next.js server stopped")
  }
}

module.exports = { startNextServer, stopNextServer }

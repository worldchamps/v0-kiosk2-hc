// Packaged APIs carry local device authority. Loopback binding alone does not stop a browser on another site.
function allowLocalRequest(request) {
  const host = String(request.headers.host || "").toLowerCase()
  if (!["localhost:3000", "127.0.0.1:3000", "[::1]:3000"].includes(host)) return false
  const origin = request.headers.origin
  if (origin !== undefined && origin !== `http://${host}`) return false
  if (request.headers["sec-fetch-site"] === "cross-site") return false
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.url?.split('?')[0].startsWith('/api/')) {
    return /^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")
  }
  return true
}
module.exports = { allowLocalRequest }

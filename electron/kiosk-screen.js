const { createHmac, timingSafeEqual } = require('node:crypto')

const MAX_IMAGE_LENGTH = 700000
function screenSignature(body, key) {
  if (!key) throw Error('Screen connection unavailable')
  return createHmac('sha256', key.replace(/\\n/g, '\n')).update('kiosk-screen:' + JSON.stringify(body)).digest('hex')
}
function verifyScreen(body, signature, key, identity, now = Date.now()) {
  if (!body || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.deviceId || '') || body.deviceId !== identity.deviceId ||
      body.property !== identity.property || body.building !== (identity.building || '') ||
      !Number.isSafeInteger(body.at) || Math.abs(now - body.at) > 60000 ||
      typeof body.version !== 'string' || body.version.length > 40 ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false
  if (body.image !== undefined && (typeof body.image !== 'string' || body.image.length > MAX_IMAGE_LENGTH ||
      !/^\/9j\/[A-Za-z0-9+/=]+$/.test(body.image))) return false
  try { return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(screenSignature(body, key), 'hex')) }
  catch { return false }
}
function createKioskScreenReporter({ identity, key, capture, fetcher = fetch, now = Date.now }) {
  let busy = false, captureUntil = 0, nextHeartbeat = 0
  return { async tick() {
    if (busy || !identity.deviceId || !key || now() < nextHeartbeat) return
    const startedAt = now()
    busy = true
    try {
      const body = { ...identity, at: now() }
      if (captureUntil > now()) {
        try {
          const image = await capture()
          if (typeof image !== 'string' || image.length > MAX_IMAGE_LENGTH || !image.startsWith('/9j/')) throw Error('No image')
          body.image = image
        } catch { body.captureError = true }
      }
      const response = await fetcher('http://localhost:3000/api/kiosk-screen-agent', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-kiosk-screen-signature': screenSignature(body, key) },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw Error('Screen report failed')
      const result = await response.json()
      captureUntil = Number.isSafeInteger(result.captureUntil) && result.captureUntil > now()
        ? Math.min(result.captureUntil, now() + 300000) : 0
      nextHeartbeat = startedAt + (captureUntil ? 5000 : 15000)
    } catch { captureUntil = 0; nextHeartbeat = startedAt + 15000 }
    finally { busy = false }
  } }
}
module.exports = { createKioskScreenReporter, screenSignature, verifyScreen, MAX_IMAGE_LENGTH }

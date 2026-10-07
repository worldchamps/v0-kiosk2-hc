const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const supported = env => env.KIOSK_PROPERTY_ID === 'property1' ||
  (env.KIOSK_PROPERTY_ID || 'property3') === 'property3' && env.KIOSK_BUILDING === 'A'
const operationId = (property, reservationId) => createHash('sha256').update(`checkin:${property}:${reservationId}`).digest('hex')
const mac = (body, key) => createHmac('sha256', key).update('card-issue-v1:' + body).digest()

// Only successful, committed server responses call this. No card data is exposed.
function issueTicket(data, env = process.env, now = Date.now()) {
  if (!supported(env) || env.CARD_DISPENSER_ENABLED !== 'true') return undefined
  if (!/^[a-f0-9]{64}$/.test(env.CARD_BRIDGE_TOKEN || '')) return { required: true }
  const claim = { property: env.KIOSK_PROPERTY_ID || 'property3', reservationId: data.reservationId,
    room: String(data.roomCode || data.roomNumber || '').replace(/[\s-]+/g, '').toUpperCase(), expiresAt: now + 300000 }
  const body = Buffer.from(JSON.stringify(claim)).toString('base64url')
  return { required: true, ticket: body + '.' + mac(body, env.CARD_BRIDGE_TOKEN).toString('hex') }
}

function verifyTicket(ticket, env, now = Date.now()) {
  if (typeof ticket !== 'string' || ticket.length > 2048 || !/^[a-f0-9]{64}$/.test(env.CARD_BRIDGE_TOKEN || '')) throw new Error('invalid_checkin_ticket')
  const [body, signature, extra] = ticket.split('.')
  if (extra !== undefined || !/^[a-f0-9]{64}$/.test(signature || '') ||
      !timingSafeEqual(mac(body, env.CARD_BRIDGE_TOKEN), Buffer.from(signature, 'hex'))) throw new Error('invalid_checkin_ticket')
  const claim = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (!supported(env) || claim.property !== (env.KIOSK_PROPERTY_ID || 'property3') ||
      typeof claim.reservationId !== 'string' || !claim.reservationId.trim() || claim.reservationId.length > 200 ||
      !Number.isFinite(claim.expiresAt) || claim.expiresAt <= now || claim.expiresAt > now + 300000 ||
      !(claim.property === 'property1' ? /^[CD]\d{3}$/ : /^A\d{3}$/).test(claim.room)) throw new Error('invalid_checkin_ticket')
  return { ...claim, operationId: operationId(claim.property, claim.reservationId) }
}
module.exports = { issueTicket, verifyTicket, operationId, supported }

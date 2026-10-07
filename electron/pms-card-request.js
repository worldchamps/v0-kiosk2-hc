const { verify, createHash } = require('node:crypto')
const { publicKey } = require('./pms-card-public-key.json')

function verifyRequest(envelope, env, now = Date.now(), key = publicKey) {
  const request = envelope?.request
  if (!request || typeof envelope.signature !== 'string' || envelope.signature.length > 1024 ||
      !verify('sha256', Buffer.from('pms-card-v1:' + JSON.stringify(request)), key, Buffer.from(envelope.signature, 'base64')))
    throw new Error('invalid_remote_request')
  const { id, room, property, deviceId, createdAt, expiresAt } = request
  if (!/^[a-f0-9-]{36}$/.test(id || '') || deviceId !== env.KIOSK_DEVICE_ID || property !== env.KIOSK_PROPERTY_ID ||
      !(property === 'property1' ? /^[CD]\d{3}$/ : property === 'property3' && env.KIOSK_BUILDING === 'A' ? /^A\d{3}$/ : /a^/).test(room) ||
      !Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now + 30000 ||
      expiresAt <= now || expiresAt - createdAt !== 600000) throw new Error('invalid_remote_request')
  return { ...request, operationId: createHash('sha256').update(`remote-key:${property}:${id}`).digest('hex') }
}
module.exports = { verifyRequest }

const { createHash, createHmac, timingSafeEqual, verify } = require('node:crypto')
const verificationKey = require('./pms-card-public-key.json').publicKey

const fingerprint = (raw, memory = raw) => createHash('sha256').update(JSON.stringify({ raw, memory })).digest('hex')
function recoverySummary(raw, memory = raw, storageError = '') {
  if (storageError) return { fingerprint: fingerprint(raw, memory), roomNumber: '', reason: String(storageError).slice(0, 500), amount: null }
  if (!raw && !memory) return null
  try {
    const value = JSON.parse(memory)
    if (!value.isActive || typeof value.recoveryRequired !== 'string' || !value.recoveryRequired) return null
    return { fingerprint: fingerprint(raw, memory), roomNumber: String(value.reservationData?.roomNumber || value.reservationData?.roomCode || '').slice(0, 40),
      reason: value.recoveryRequired.slice(0, 500), amount: Number.isSafeInteger(value.acceptedAmount) ? value.acceptedAmount : null }
  } catch { return { fingerprint: fingerprint(raw, memory), roomNumber: '', reason: '결제 기록을 읽지 못했습니다. 현장에서 원본을 확인해 주세요.', amount: null } }
}
function operationsSignature(body, key) {
  return createHmac('sha256', key.replace(/\\n/g, '\n')).update('kiosk-operations-v1:' + JSON.stringify(body)).digest('hex')
}
function verifyOperations(body, signature, key, identity, now = Date.now()) {
  try {
    if (!key || !body || body.deviceId !== identity.deviceId || !/^[\w-]{8,80}$/.test(body.deviceId || '') ||
      body.property !== identity.property || body.building !== identity.building || typeof body.version !== 'string' || body.version.length > 40 ||
      !Number.isSafeInteger(body.at) || Math.abs(now - body.at) > 60000 || !/^[a-f0-9]{64}$/.test(signature || '')) return false
    const recovery = body.recovery
    if (recovery !== null && (!recovery || !/^[a-f0-9]{64}$/.test(recovery.fingerprint || '') ||
      typeof recovery.roomNumber !== 'string' || recovery.roomNumber.length > 40 || typeof recovery.reason !== 'string' || recovery.reason.length > 500 ||
      recovery.amount !== null && (!Number.isSafeInteger(recovery.amount) || recovery.amount < 0))) return false
    const printer = body.printer
    if (printer !== null && (!printer || !['sent', 'failed'].includes(printer.status) || typeof printer.error !== 'string' || printer.error.length > 500 ||
      typeof printer.roomNumber !== 'string' || printer.roomNumber.length > 40 || !Number.isSafeInteger(printer.at))) return false
    const result = body.result
    if (result !== null && (!result || !/^[a-f0-9-]{36}$/.test(result.id || '') || !['completed', 'failed'].includes(result.status) ||
      typeof result.error !== 'string' || result.error.length > 500)) return false
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(operationsSignature(body, key), 'hex'))
  } catch { return false }
}
function verifyRecoveryCommand(job, raw, identity, now = Date.now(), publicKey = verificationKey, memory = raw) {
  try {
    const r = job?.request
    return !!r && r.action === 'archive_payment' && /^[a-f0-9-]{36}$/.test(r.id || '') && r.deviceId === identity.deviceId &&
      r.property === identity.property && r.building === identity.building && r.fingerprint === fingerprint(raw, memory) &&
      r.confirmed === true && Number.isSafeInteger(r.createdAt) && Number.isSafeInteger(r.expiresAt) &&
      r.createdAt <= now && r.expiresAt > now && r.expiresAt - r.createdAt <= 120000 &&
      verify('sha256', Buffer.from('pms-recovery-v1:' + JSON.stringify(r)), publicKey, Buffer.from(job.signature, 'base64'))
  } catch { return false }
}
function createOperationsReporter({ identity, key, read, recover, fetcher = fetch, now = Date.now }) {
  let busy = false, result = null
  return { async tick() {
    if (busy || !identity.deviceId || !key) return
    busy = true
    try {
      const state = await read()
      const body = { ...identity, at: now(), recovery: recoverySummary(state.raw, state.memory, state.storageError), printer: state.printer || null, result }
      const response = await fetcher('http://localhost:3000/api/kiosk-operations-agent', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-kiosk-operations-signature': operationsSignature(body, key) }, body: JSON.stringify(body),
      })
      if (!response.ok) return
      const { command } = await response.json()
      if (!command || command.request?.id === result?.id || !verifyRecoveryCommand(command, state.raw, identity, now(), undefined, state.memory)) return
      try {
        await recover(command)
        result = { id: command.request.id, status: 'completed', error: '' }
      } catch (error) { result = { id: command.request.id, status: 'failed', error: String(error.message || '복구를 완료하지 못했습니다.').slice(0, 500) } }
    } catch { /* Retain the last result and retry delivery; never clear a local payment on network failure. */ }
    finally { busy = false }
  } }
}
module.exports = { fingerprint, recoverySummary, operationsSignature, verifyOperations, verifyRecoveryCommand, createOperationsReporter }

const fs = require('node:fs')
const path = require('node:path')
const { createHmac, timingSafeEqual } = require('node:crypto')

function incidentSignature(body, key) {
  if (!key) throw new Error('PMS connection credentials unavailable')
  return createHmac('sha256', key.replace(/\\n/g, '\n')).update('kiosk-cash-incident:' + JSON.stringify(body)).digest('hex')
}
function verifyIncident(body, signature, key, scope) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false
  if (!body || !/^[a-f0-9]{64}$/.test(body.id || '') || body.property !== scope.property ||
      (scope.building && body.building !== scope.building) || body.status !== 'needs_review' ||
      body.bookingCreated !== false || body.refundConfirmed !== false ||
      !Number.isFinite(body.occurredAt) || typeof body.reason !== 'string' || body.reason.length > 500) return false
  for (const field of ['receivedAmount', 'confirmedReturnedAmount', 'cashRecordedAmount', 'requiredAmount', 'expectedChange']) {
    if (!Number.isSafeInteger(body[field]) || body[field] < 0 || body[field] > 100000000) return false
  }
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(incidentSignature(body, key), 'hex'))
}
function incidentFromArchive(record) {
  const session = JSON.parse(record.memorySnapshot)
  return {
    id: record.archiveId, property: record.property, building: record.building || '',
    roomNumber: String(session.reservationData?.roomNumber || session.reservationData?.roomCode || '').slice(0, 40),
    occurredAt: session.sessionStartTime, recordedAt: record.reviewedAt, version: record.version,
    reason: String(session.recoveryRequired || '현금 처리 오류').slice(0, 500),
    receivedAmount: session.acceptedBills.reduce((total, bill) => total + bill, 0),
    confirmedReturnedAmount: session.returnedAmount || 0,
    cashRecordedAmount: session.acceptedAmount, requiredAmount: session.requiredAmount,
    expectedChange: Math.max(0, session.acceptedAmount - session.requiredAmount),
    status: 'needs_review', bookingCreated: false, refundConfirmed: false,
  }
}
function createCashIncidentDelivery({ app, safeStorage, fetcher = fetch }) {
  let busy = false
  return async function flush() {
    if (busy) return
    busy = true
    try {
      const directory = path.join(app.getPath('userData'), 'payment-recovery-archive')
      if (!fs.existsSync(directory)) return
      for (const name of fs.readdirSync(directory)) {
        if (!/^[a-f0-9]{64}\.bin$/.test(name) || fs.existsSync(path.join(directory, name + '.sent'))) continue
        try {
          const file = path.join(directory, name), stat = fs.lstatSync(file)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) continue
          const record = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
          if (record.kind !== 'cash-incident-awaiting-review') continue
          const incident = incidentFromArchive(record)
          const response = await fetcher('http://localhost:3000/api/kiosk-payment-incidents', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json', 'x-kiosk-incident-signature': incidentSignature(incident, process.env.FIREBASE_PRIVATE_KEY) },
            body: JSON.stringify(incident),
          })
          const result = await response.json()
          if (!response.ok || result.id !== incident.id || result.success !== true) throw new Error('PMS receipt not confirmed')
          const fd = fs.openSync(file + '.sent', 'w', 0o600)
          try { fs.writeFileSync(fd, new Date().toISOString()); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        } catch { console.warn('PMS cash incident delivery pending; retained locally for retry.') }
      }
    } catch { console.warn('PMS cash incident delivery pending; retained locally for retry.') }
    finally { busy = false }
  }
}
module.exports = { incidentSignature, verifyIncident, incidentFromArchive, createCashIncidentDelivery }

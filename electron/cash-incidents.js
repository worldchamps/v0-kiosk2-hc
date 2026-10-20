const fs = require('node:fs')
const path = require('node:path')
const { createHmac, timingSafeEqual } = require('node:crypto')

function incidentSignature(body, key) {
  if (!key) throw new Error('PMS connection credentials unavailable')
  return createHmac('sha256', key.replace(/\\n/g, '\n')).update('kiosk-cash-incident:' + JSON.stringify(body)).digest('hex')
}
function validCollection(collection) {
  return collection && typeof collection === 'object' && !Array.isArray(collection) &&
    Object.keys(collection).length === 5 &&
    Object.keys(collection).every(key => ['reservationId', 'amount', 'method', 'paymentKey', 'pmsStatus'].includes(key)) &&
    typeof collection.reservationId === 'string' && collection.reservationId.trim().length > 0 && collection.reservationId.length <= 200 &&
    Number.isSafeInteger(collection.amount) && collection.amount >= 0 &&
    ['카드', '현금'].includes(collection.method) &&
    typeof collection.paymentKey === 'string' && collection.paymentKey.trim().length > 0 && collection.paymentKey.length <= 300 &&
    typeof collection.pmsStatus === 'string' && collection.pmsStatus.length <= 40
}
function verifyIncident(body, signature, key, scope) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false
  if (!body || !/^[a-f0-9]{64}$/.test(body.id || '') || body.property !== scope.property ||
      (scope.building && body.building !== scope.building) || body.status !== 'needs_review' ||
      body.bookingCreated !== false || body.refundConfirmed !== false ||
      !Number.isFinite(body.occurredAt) || typeof body.reason !== 'string' || body.reason.length > 500 ||
      body.kind !== undefined && !['cash', 'card_approval', 'unknown_result', 'booking_pending', 'collection_unrecorded', 'corrupt', 'change_owed'].includes(body.kind)) return false
  if (body.kind === 'collection_unrecorded' ? !validCollection(body.collection) : Object.hasOwn(body, 'collection')) return false
  for (const field of ['receivedAmount', 'confirmedReturnedAmount', 'cashRecordedAmount', 'requiredAmount', 'expectedChange']) {
    if (!Number.isSafeInteger(body[field]) || body[field] < 0 ||
        body[field] > 100000000 && !(field === 'requiredAmount' && body.kind === 'collection_unrecorded')) return false
  }
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(incidentSignature(body, key), 'hex'))
}
function incidentFromArchive(record) {
  let session
  try { session = JSON.parse(record.memorySnapshot) } catch { session = {} }
  const amount = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100000000) : 0
  const changeOwed = record.incidentKind === 'change_owed'
  let kind = record.incidentKind || 'cash'
  let collection
  if (kind === 'collection_unrecorded') {
    try {
      const body = JSON.parse(session.pendingBooking.body)
      collection = { reservationId: body.reservationId, amount: body.amount,
        method: body.payment?.method === 'CARD' ? '카드' : body.payment?.method === 'CASH' ? '현금' : null,
        paymentKey: body.requestId, pmsStatus: session.pendingBooking.lastStatus ?? '' }
      if (!validCollection(collection)) throw new Error('Invalid collection evidence')
    } catch {
      kind = 'corrupt'
      collection = undefined
    }
  }
  return {
    id: record.archiveId, property: record.property, building: record.building || '',
    roomNumber: String(session.reservationData?.roomNumber || session.reservationData?.roomCode || '').slice(0, 40),
    occurredAt: Number.isSafeInteger(session.sessionStartTime) && session.sessionStartTime > 0
      ? session.sessionStartTime : Date.parse(record.reviewedAt), recordedAt: record.reviewedAt, version: record.version,
    reason: collection ? `결제 완료·PMS 수금 기록 미확인 (${collection.pmsStatus})` : changeOwed
      ? session.changeUncertain
        ? `거스름돈 지급 미확인(최대 ${amount(session.changeOwed).toLocaleString('ko-KR')}원) · 객실 배정 진행`
        : `거스름돈 미지급 ${amount(session.changeOwed).toLocaleString('ko-KR')}원 · 객실 배정 진행`
      : String(session.recoveryRequired || 'payment_record_unavailable').slice(0, 500),
    kind,
    receivedAmount: changeOwed ? amount(session.receivedAmount)
      : Array.isArray(session.acceptedBills) ? Math.min(100000000, session.acceptedBills.reduce((total, bill) => total + amount(bill), 0)) : 0,
    confirmedReturnedAmount: amount(session.returnedAmount),
    cashRecordedAmount: amount(session.acceptedAmount), requiredAmount: collection ? collection.amount : amount(session.requiredAmount),
    expectedChange: changeOwed ? amount(session.changeOwed) : Math.max(0, amount(session.acceptedAmount) - amount(session.requiredAmount)),
    status: 'needs_review', bookingCreated: false, refundConfirmed: false,
    ...(collection ? { collection } : {}),
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
          if (!['cash-incident-awaiting-review', 'payment-incident-awaiting-review'].includes(record.kind)) continue
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

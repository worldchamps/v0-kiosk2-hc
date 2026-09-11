const fs = require('node:fs')
const path = require('node:path')
const { createHash, timingSafeEqual } = require('node:crypto')

const STORAGE_KEY = 'kiosk-payment-recovery-v1'
// Matches the existing operator keypad. Never send the password to the renderer
// or write it into recovery records. An installed PC may override it locally.
const LEGACY_PASSWORD_HASH = 'eabf14e0b8c9ab2ce7235ed47592f93a0675a824d5dbba989930bce817608633'
const hash = value => createHash('sha256').update(value).digest('hex')
class RecoveryError extends Error {}
const check = (condition, message) => { if (!condition) throw new RecoveryError(message) }

function isZeroCash(session) {
  return session?.isActive === true && session.method === 'cash' && session.acceptedAmount === 0 &&
    Array.isArray(session.acceptedBills) && session.acceptedBills.length === 0 && !session.returnedAmount &&
    !session.cardInFlight && !session.recoveryEvidence && !session.pendingBooking
}

function createPaymentRecovery({ app, safeStorage, isIdle, stopCash, setBusy, now = Date.now }) {
  let failures = 0, blockedUntil = 0, busy = false
  function authenticate(event, password) {
    check(event.senderFrame === event.sender.mainFrame &&
      new URL(event.senderFrame.url).origin === 'http://localhost:3000', '키오스크 화면에서만 복구할 수 있습니다.')
    check(now() >= blockedUntil, '비밀번호 입력 횟수가 초과되었습니다. 1분 후 다시 시도해주세요.')
    const expected = process.env.KIOSK_ADMIN_PASSWORD ? hash(process.env.KIOSK_ADMIN_PASSWORD) : LEGACY_PASSWORD_HASH
    const valid = typeof password === 'string' && password.length <= 128 &&
      timingSafeEqual(Buffer.from(hash(password), 'hex'), Buffer.from(expected, 'hex'))
    if (!valid) {
      if (++failures >= 5) { blockedUntil = now() + 60000; failures = 0 }
      throw new RecoveryError('관리자 비밀번호가 일치하지 않습니다.')
    }
    failures = 0
  }
  const readCurrent = event => event.sender.executeJavaScript(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`)
  const failed = error => ({ success: false, error: error instanceof RecoveryError ? error.message :
    '복구 기록을 안전하게 보관하지 못했습니다. 기존 거래는 유지됩니다. 다시 확인해주세요.' })

  return {
    authorize(event, password) {
      try { authenticate(event, password); return { success: true } } catch (error) { return failed(error) }
    },
    async archive(event, input) {
      let acquired = false
      try {
        authenticate(event, input?.password)
        check(!busy && isIdle(), '진행 중인 결제·예약·장비 요청이 있습니다. 완료 후 다시 확인해주세요.')
        check(input.expectedRaw === null || (typeof input.expectedRaw === 'string' && input.expectedRaw.length > 0 && input.expectedRaw.length <= 262144),
          '보관할 결제 기록을 읽지 못했습니다. 전체 데이터를 삭제하지 말고 관리자에게 문의해주세요.')
        check(typeof input.memorySnapshot === 'string' && input.memorySnapshot.length <= 262144,
          '화면의 결제 기록을 읽지 못했습니다. 잠금은 유지됩니다.')
        const memorySession = JSON.parse(input.memorySnapshot)
        check(memorySession && typeof memorySession === 'object' &&
          (input.expectedRaw !== null || memorySession.isActive === true), '보관할 거래 정보가 없습니다.')
        check(input.confirmed === true && ['zero_cash', 'operator_resolved'].includes(input.resolution), '실제 처리 결과 확인이 필요합니다.')
        check(['현금 미투입 취소', '승인 내역 없음 확인', '관리자 정산 완료'].includes(input.note), '처리 결과를 선택해주세요.')
        // Acquire before the first await so simultaneous IPC requests cannot
        // both pass the idle check and send overlapping stop commands.
        busy = acquired = true
        setBusy(true)
        check(await readCurrent(event) === input.expectedRaw, '결제 기록이 변경되었습니다. 화면을 다시 확인해주세요.')
        let session
        try { session = JSON.parse(input.expectedRaw) } catch { /* Preserve malformed evidence verbatim for an operator review. */ }
        if (input.resolution === 'zero_cash' || input.note === '현금 미투입 취소') check(input.resolution === 'zero_cash' &&
          input.note === '현금 미투입 취소' && isZeroCash(session) && isZeroCash(memorySession), '현금 미투입 건으로 해제할 수 없는 기록입니다. 실제 결제·반환 결과를 확인해주세요.')
        if (input.note === '승인 내역 없음 확인') check([session, memorySession].every(value => value?.method === 'card' && value.acceptedAmount === 0),
          '카드 승인 내역 확인만으로 현금 관련 기록을 해제할 수 없습니다.')
        // No reset, payout, card approval or cancellation: only close the cash
        // inlet. A card-only session never requires an unrelated device.
        if (![session, memorySession].every(value => value?.method === 'card' && value.acceptedAmount === 0 &&
          Array.isArray(value.acceptedBills) && value.acceptedBills.length === 0 && !value.returnedAmount)) {
          check(await stopCash(), '지폐 투입구 정지 응답이 없습니다. 인식기 연결을 확인한 뒤 복구를 다시 눌러주세요. 현금 반환 명령은 보내지 않았습니다.')
        }
        check(await readCurrent(event) === input.expectedRaw, '결제 기록이 변경되었습니다. 잠금은 유지됩니다.')
        check(safeStorage.isEncryptionAvailable(), '암호화 보관을 사용할 수 없어 잠금을 유지합니다.')
        const identity = { original: input.expectedRaw, memorySnapshot: input.memorySnapshot, resolution: input.resolution, note: input.note }
        check(Buffer.byteLength(JSON.stringify(identity), 'utf8') < 900000, '결제 기록이 너무 커 보관하지 못했습니다. 잠금은 유지됩니다.')
        const archiveId = hash(JSON.stringify(identity))
        const directory = path.join(app.getPath('userData'), 'payment-recovery-archive')
        fs.mkdirSync(directory, { recursive: true })
        check(!fs.lstatSync(directory).isSymbolicLink(), '복구 보관 폴더를 확인해주세요.')
        const file = path.join(directory, archiveId + '.bin')
        const record = { ...identity, archiveId, reviewedAt: new Date(now()).toISOString(), version: app.getVersion(),
          property: process.env.KIOSK_PROPERTY_ID || null, building: process.env.KIOSK_BUILDING || process.env.KIOSK_START_LOCATION || null,
          kind: 'operator-reviewed-local-unlock', financialCommandsSent: 0 }
        try {
          const encrypted = safeStorage.encryptString(JSON.stringify(record))
          const fd = fs.openSync(file, 'wx', 0o600)
          try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        } catch (error) { if (error.code !== 'EEXIST') throw error }
        const stat = fs.lstatSync(file)
        check(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024, '복구 보관 파일을 확인해주세요.')
        const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
        check(saved.original === identity.original && saved.memorySnapshot === identity.memorySnapshot &&
          saved.resolution === identity.resolution && saved.note === identity.note &&
          saved.archiveId === archiveId, '복구 기록 보관 확인에 실패해 잠금을 유지합니다.')
        check(await readCurrent(event) === input.expectedRaw, '보관 중 결제 기록이 변경되어 잠금을 유지합니다.')
        // Renderer compares the same snapshot again before removing exactly one
        // key. A lost IPC response leaves the original and this archive intact.
        return { success: true, archiveId }
      } catch (error) { return failed(error) }
      finally { if (acquired) { busy = false; setBusy(false) } }
    },
  }
}

module.exports = { createPaymentRecovery, isZeroCash, STORAGE_KEY }

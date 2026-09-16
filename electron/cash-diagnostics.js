const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const packet = (a, b, c) => [0x24, a, b, c, (a + b + c) & 255]
const commands = { reset: packet(0x52, 0x53, 0x54), stop: packet(0x53, 0x43, 0x1c) }
const validBytes = value => Array.isArray(value) && value.length <= 512 && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)

// Only cash-device protocol fields are retained. Never persist arbitrary IPC,
// child-process output, credentials, reservation bodies or printer contents.
function createCashTrace(directory, maxBytes = 5 * 1024 * 1024) {
  const file = path.join(directory, 'cash-device.jsonl')
  let error = ''
  function write(layer, input = {}) {
    if (!['renderer', 'bridge', 'serial', 'diagnostic'].includes(layer)) return
    const row = { at: new Date().toISOString(), layer }
    if (['send', 'receive', 'result', 'connected', 'disconnected', 'read_error', 'write_error', 'connect_error', 'invalid_packet'].includes(input.event)) row.event = input.event
    else return
    if (validBytes(input.bytes)) row.bytes = input.bytes
    if (validBytes(input.response)) row.response = input.response
    if (['ok', 'ng', 'timeout', 'late_ok', 'late_ng', 'send_failed', 'busy', 'unavailable'].includes(input.result)) row.result = input.result
    if (Number.isFinite(input.elapsedMs)) row.elapsedMs = Math.max(0, Math.min(60000, input.elapsedMs))
    if (Number.isFinite(input.sentAt)) row.sentAt = input.sentAt
    if (typeof input.serialAt === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}$/.test(input.serialAt)) row.serialAt = input.serialAt
    try {
      fs.mkdirSync(directory, { recursive: true })
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        for (let i = 3; i >= 1; i--) {
          const source = i === 1 ? file : file + '.' + (i - 1)
          const target = file + '.' + i
          if (fs.existsSync(target)) fs.unlinkSync(target)
          if (fs.existsSync(source)) fs.renameSync(source, target)
        }
      }
      const line = JSON.stringify(row) + '\n'
      fs.appendFileSync(file, line, { mode: 0o600 })
      if (row.event === 'result' && row.result && row.result !== 'ok') {
        fs.writeFileSync(path.join(directory, 'cash-last-failure.jsonl'), tail() + '\n', { mode: 0o600 })
      }
      error = ''
    } catch { error = '현금 통신 기록 저장 실패: 디스크 공간과 폴더 권한을 확인해주세요.' }
  }
  function tail() {
    return [file + '.1', file].filter(p => fs.existsSync(p)).map(p => fs.readFileSync(p, 'utf8')).join('').trim().split('\n').slice(-200).join('\n')
  }
  function read() {
    try { return { success: !error, error, path: file, text: tail() } }
    catch { return { success: false, error: '현금 통신 기록을 읽지 못했습니다.' } }
  }
  function capture(stream) {
    if (!stream) return
    const lines = readline.createInterface({ input: stream })
    lines.on('line', line => {
      const bytes = line.match(/SerialManager - INFO - \[Acceptor\] (Sent|Received): ([A-F0-9]{2,1024})$/)
      if (bytes) {
        write('serial', { event: bytes[1] === 'Sent' ? 'send' : 'receive', bytes: Array.from(Buffer.from(bytes[2], 'hex')), serialAt: line.slice(0, 23) })
        return
      }
      const event = line.includes('SerialManager -') && line.includes('[Acceptor]')
        ? line.includes('Read error:') ? 'read_error' : line.includes('Write error:') || line.includes('Incomplete serial write') ? 'write_error'
          : line.includes('Failed to connect') ? 'connect_error' : line.includes('Attempting to reconnect') ? 'disconnected'
            : line.includes('Connected to') ? 'connected' : ''
        : line.includes('Acceptor - WARNING - Invalid checksum') ? 'invalid_packet' : ''
      if (event) write('serial', { event })
    })
  }
  return { write, read, capture }
}

function responsePacket(message) {
  if (message.type === 'acceptor_ok' || message.type === 'acceptor_ng') {
    if (!Number.isInteger(message.data) || message.data < 0 || message.data > 255) return null
    return message.type === 'acceptor_ok' ? packet(0x4f, 0x4b, message.data) : packet(0x4e, 0x47, message.data)
  }
  const p = message.type === 'acceptor_raw' ? message.packet : null
  return validBytes(p) && p.length === 5 && p[0] === 0x24 && p[4] === ((p[1] + p[2] + p[3]) & 255) ? p : null
}

function createCashDiagnostics({ authorize, isIdle, setBusy, readPayment, bridge, trace, now = Date.now, observeMs = 8000, timeoutMs = 3000 }) {
  let busy = false
  return {
    read(event, password) {
      const auth = authorize(event, password)
      return auth.success ? trace.read() : auth
    },
    async run(event, input) {
      const auth = authorize(event, input?.password)
      if (!auth.success) return auth
      if (!Object.hasOwn(commands, input?.command || '') || input?.confirmed !== true) return { success: false, error: '무현금 점검 항목과 거래 없음 확인이 필요합니다.' }
      if (busy || !isIdle()) return { success: false, error: '다른 결제·예약·장비 요청이 끝난 뒤 점검해주세요.' }
      busy = true
      setBusy(true)
      try {
        // Even an inactive or malformed journal is evidence: never reset it.
        if (await readPayment(event) !== null) return { success: false, error: '남아 있는 결제 기록을 먼저 확인해주세요. 점검 명령은 보내지 않았습니다.' }
        if (!bridge.isConnected) return { success: false, error: '장비 제어 프로그램 연결이 끊겨 있습니다.' }
        if (!trace.read().success) return { success: false, error: '기록을 저장할 수 없어 점검을 시작하지 않았습니다.' }
        const bytes = commands[input.command]
        const started = now()
        trace.write('diagnostic', { event: 'send', bytes, sentAt: started })
        if (!trace.read().success) return { success: false, error: '기록을 저장할 수 없어 점검을 시작하지 않았습니다.' }
        return await new Promise(resolve => {
          let result = null, timer, unsubscribe = () => {}
          const finish = () => {
            clearTimeout(timer); unsubscribe()
            result ||= { result: 'timeout', elapsedMs: now() - started }
            trace.write('diagnostic', { event: 'result', bytes, sentAt: started, ...result })
            resolve({ success: true, command: input.command, ...result, logSaved: trace.read().success })
          }
          unsubscribe = bridge.subscribeMessage(message => {
            const p = responsePacket(message)
            if (!p || result) return
            const status = p[1] === 0x4f && p[2] === 0x4b ? 'ok' : p[1] === 0x4e && p[2] === 0x47 ? 'ng' : null
            if (!status) return
            const elapsedMs = now() - started
            result = { result: (elapsedMs >= timeoutMs ? 'late_' : '') + status, elapsedMs, response: p }
          })
          // Keep the lock for the full observation window. A late OK must not
          // be consumed as the next test's response. No automatic retries.
          timer = setTimeout(finish, observeMs)
          try {
            if (!bridge.send({ type: 'raw_acceptor', data: bytes })) { result = { result: 'send_failed', elapsedMs: now() - started }; finish() }
          } catch { result = { result: 'send_failed', elapsedMs: now() - started }; finish() }
        })
      } catch { return { success: false, error: '점검을 완료하지 못했습니다. 통신 기록을 확인해주세요.' } }
      finally { busy = false; setBusy(false) }
    },
  }
}

module.exports = { createCashTrace, createCashDiagnostics, responsePacket }

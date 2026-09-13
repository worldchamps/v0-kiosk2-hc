const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

function fixture(address = 'ws://192.0.2.10:9000/kiosk') {
  const sockets = [], timers = new Set(), intervals = new Set()
  class Socket extends EventEmitter {
    static OPEN = 1; static CONNECTING = 0
    constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; sockets.push(this) }
    send(data) { this.sent.push(JSON.parse(data)) }
    ping() { this.pings = (this.pings || 0) + 1 }
    terminate() { this.readyState = 3; this.emit('close') }
    close() { this.terminate() }
    open() { this.readyState = 1; this.emit('open') }
    auth(success) { this.emit('message', Buffer.from(JSON.stringify({ type: 'AUTH_RESULT', success }))) }
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/toss-front-bridge'), 'utf8'), {
    module, process: { env: { TOSS_FRONT_WS_URL: address, TOSS_FRONT_PAIRING_KEY: 'synthetic-key-not-for-production', TOSS_FRONT_TRANSPORT: 'websocket' } },
    require: name => name === 'ws' ? Socket : name === 'serialport' ? { SerialPort: class {} } : require(name),
    Buffer, URL, console,
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.add(timer); return timer }, clearTimeout(t) { timers.delete(t) },
    setInterval(fn, ms) { const timer = { fn, ms }; intervals.add(timer); return timer }, clearInterval(t) { intervals.delete(t) },
  })
  const bridge = module.exports
  return { bridge, sockets, timers, intervals, fire(ms) {
    const timer = [...timers].find(t => t.ms === ms); assert(timer, `Missing ${ms} ms timer`)
    timers.delete(timer); timer.fn()
  } }
}

test('Front LAN IP defaults to the documented 9000/kiosk endpoint and keeps explicit endpoints', () => {
  assert.equal(fixture('192.0.2.10').bridge.status.url, 'ws://192.0.2.10:9000/kiosk')
  assert.equal(fixture('ws://192.0.2.10').bridge.status.url, 'ws://192.0.2.10:9000/kiosk')
  assert.equal(fixture('ws://192.0.2.10:19000/custom').bridge.status.url, 'ws://192.0.2.10:19000/custom')
})

test('silent authentication closes the stale socket and reconnects; getStatus retains the diagnosis', () => {
  const h = fixture(); h.bridge.connect(); h.sockets[0].open()
  h.fire(5000)
  assert.equal(h.bridge.status.connected, false)
  assert.match(h.bridge.status.error, /인증 응답/)
  assert(!h.bridge.status.error.includes('synthetic-key'))
  h.fire(1000); h.sockets[1].open(); h.sockets[1].auth(true)
  assert.equal(h.bridge.status.authenticated, true)
  assert.equal(h.bridge.status.error, undefined)
  assert(![...h.timers].some(t => t.ms === 5000))
  h.bridge.close(); assert.equal(h.intervals.size, 0)
})

test('LAN half-open connection is detected by ping and recovers without submitting a payment', () => {
  const h = fixture(); h.bridge.connect(); const socket = h.sockets[0]; socket.open(); socket.auth(true)
  const heartbeat = [...h.intervals][0]; heartbeat.fn()
  socket.emit('pong'); assert.equal(h.timers.size, 0)
  heartbeat.fn(); h.fire(5000)
  assert.equal(h.bridge.status.connected, false)
  assert.match(h.bridge.status.error, /네트워크/)
  assert.equal(socket.sent.filter(m => m.type === 'PAYMENT_REQUEST').length, 0)
  h.bridge.close()
})

test('reconnect cannot interrupt a financial request, and failed authentication before dispatch is safe to retry', async () => {
  const h = fixture(); h.bridge.connect(); h.sockets[0].open(); h.sockets[0].auth(true)
  const pending = h.bridge.request('PAYMENT_REQUEST', { amount: 30000, paymentKey: 'test' })
  const rejected = assert.rejects(pending)
  h.bridge.reconnect(); assert.equal(h.sockets.length, 1)
  h.bridge.close(); await rejected
  const offline = fixture(); const attempt = offline.bridge.requestPayment({ amount: 30000 })
  const failure = assert.rejects(attempt, error => error.code === 'PAYMENT_NOT_APPROVED')
  offline.fire(10000); await failure
  assert.equal(offline.sockets[0].sent.length, 0)
  offline.bridge.close()
})

test('Front authentication rejection and network refusal remain visible until a successful authentication', () => {
  const h = fixture(); h.bridge.connect(); h.sockets[0].open(); h.sockets[0].auth(false)
  assert.match(h.bridge.status.error, /페어링 키/)
  h.fire(1000)
  h.sockets[1].emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
  assert.match(h.bridge.status.error, /IP·9000/)
  h.bridge.close()
})

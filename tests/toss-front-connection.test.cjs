const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

function fixture(address = 'ws://192.0.2.10:9000/kiosk', enabled, env = {}) {
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
    module, process: { env: { ...(enabled === undefined ? {} : { TOSS_FRONT_ENABLED: enabled }),
      TOSS_FRONT_WS_URL: address, TOSS_FRONT_PAIRING_KEY: 'synthetic-key-not-for-production', TOSS_FRONT_TRANSPORT: 'websocket', ...env } },
    require: name => name === 'ws' ? Socket : name === 'serialport' ? { SerialPort: class {} }
      : name === './toss-front-config' ? require('../electron/toss-front-config') : require(name),
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

test('legacy missing or empty switch and explicit true retain the configured terminal connection', () => {
  for (const enabled of [undefined, '', 'true']) {
    const h = fixture('ws://192.0.2.10:9000/kiosk', enabled)
    assert.equal(h.bridge.enabled, true)
    assert.equal(h.bridge.configured, true)
    h.bridge.connect(); h.sockets[0].open(); h.sockets[0].auth(true)
    assert.equal(h.bridge.status.authenticated, true)
    assert.deepEqual(h.sockets[0].sent.map(message => message.type), ['AUTH'])
    h.bridge.close(); assert.equal(h.timers.size, 0); assert.equal(h.intervals.size, 0)
  }
})

test('explicit false disables stale serial and websocket pairing without connecting or retrying', () => {
  const h = fixture('ws://192.0.2.10:9000/kiosk', 'false', { TOSS_FRONT_SERIAL_PATH: 'COM8' })
  assert.equal(h.bridge.enabled, false)
  assert.equal(h.bridge.configured, false)
  h.bridge.connect(); h.bridge.reconnect(); h.bridge.scheduleReconnect()
  assert.equal(h.sockets.length, 0)
  assert.equal(h.timers.size, 0)
})

test('legacy serial configuration is enabled, and every mode still requires pairing plus transport', () => {
  for (const enabled of [undefined, '', 'true']) {
    const serial = fixture('', enabled, { TOSS_FRONT_TRANSPORT: 'serial', TOSS_FRONT_SERIAL_PATH: 'COM8' })
    assert.equal(serial.bridge.enabled, true)
    assert.equal(serial.bridge.configured, true)
    for (const env of [{ TOSS_FRONT_PAIRING_KEY: '' }, { TOSS_FRONT_PAIRING_KEY: '   ' },
      { TOSS_FRONT_WS_URL: '', TOSS_FRONT_SERIAL_PATH: '' }, { TOSS_FRONT_WS_URL: '   ', TOSS_FRONT_SERIAL_PATH: '   ' }]) {
      const h = fixture(undefined, enabled, env)
      assert.equal(h.bridge.configured, false)
      if (enabled !== 'true') assert.equal(h.bridge.enabled, false)
    }
  }
})

test('packaged bootstrap preserves the missing switch and copies explicit and empty choices unchanged', () => {
  const source = fs.readFileSync(require.resolve('../electron/bootstrap'), 'utf8')
  const assignment = source.slice(source.indexOf('    Object.assign(process.env, config.env,'), source.indexOf('    app.setLoginItemSettings('))
  for (const enabled of [undefined, '', 'true', 'false']) {
    const env = {}, saved = { TOSS_FRONT_PAIRING_KEY: 'synthetic-key-not-for-production', TOSS_FRONT_WS_URL: 'ws://192.0.2.10:9000/kiosk' }
    if (enabled !== undefined) saved.TOSS_FRONT_ENABLED = enabled
    vm.runInNewContext(assignment, { process: { env }, config: { env: saved, property: 'property3', deviceId: 'test' }, overlayMode: false })
    assert.equal(Object.hasOwn(env, 'TOSS_FRONT_ENABLED'), enabled !== undefined)
    assert.equal(env.TOSS_FRONT_ENABLED, enabled)
    assert.equal(fixture(undefined, undefined, env).bridge.configured, enabled !== 'false')
  }
})

test('native device recovery includes legacy and explicitly enabled terminals but omits explicit false', () => {
  const source = fs.readFileSync(require.resolve('../electron/main'), 'utf8')
  const configuration = source.slice(source.indexOf('  const karivOverlay ='), source.indexOf('  deviceRecovery = createDeviceRecovery('))
  const { createDeviceRecovery } = require('../electron/device-recovery')
  for (const property of ['property1', 'property2', 'property3', 'property4']) {
    for (const enabled of [undefined, '', 'true', 'false']) {
      for (const serial of [false, true]) {
        const h = serial ? fixture('', enabled, { TOSS_FRONT_SERIAL_PATH: 'COM8' }) : fixture(undefined, enabled)
        const context = { OVERLAY_MODE: false, KIOSK_PROPERTY_ID: property, tossFrontBridge: h.bridge,
          cardDispenserEnabled: () => false, process: { env: {} } }
        vm.runInNewContext(configuration + '\nresult = configured', context)
        const recovery = createDeviceRecovery({ configured: Array.from(context.result), terminal: h.bridge })
        assert.equal(Object.hasOwn(recovery.hardware, 'cardTerminal'), enabled !== 'false')
      }
    }
  }
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

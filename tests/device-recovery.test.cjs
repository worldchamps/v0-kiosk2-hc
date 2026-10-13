const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { createDeviceRecovery, runRemoteReset } = require('../electron/device-recovery')

function fixture(configured = ['acceptor', 'dispenser', 'cardTerminal', 'printer', 'cardDispenser'], profile = {}) {
  const calls = [], listeners = new Set(), busyChanges = [], timers = new Map()
  let idle = true, restartAllowed, now = 1000000, fault = null, restarts = 0, timerId = 0
  const scheduleTimeout = (callback, ms) => {
    const id = ++timerId
    timers.set(id, { at: now + ms, callback })
    return id
  }
  async function run(operation) {
    let settled = false
    const result = operation().finally(() => { settled = true })
    while (!settled) {
      // Let promise continuations schedule the next exchange before advancing virtual time.
      await Promise.resolve()
      if (settled || !timers.size) continue
      const [id, timer] = [...timers].sort(([, a], [, b]) => a.at - b.at)[0]
      timers.delete(id)
      now = Math.max(now, timer.at)
      timer.callback()
    }
    assert.equal(timers.size, 0, 'recovery leaves no pending timers')
    assert.equal(listeners.size, 0, 'recovery unsubscribes from bridge replies')
    return result
  }
  const bridge = { isConnected: true,
    subscribeMessage(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    send(message) {
      calls.push(message)
      if (!bridge.isConnected) return false
      scheduleTimeout(() => {
        if (fault === 'timeout') return
        const p = message.data
        let reply
        if (message.type === 'ping') reply = { type: 'pong' }
        else if (message.type === 'cash_board_recover') reply = { type: 'cash_board_result', requestId: message.requestId,
          target: message.target, success: fault !== 'ng', verified: fault !== 'unverified' && fault !== 'ng' }
        else if (message.type === 'printer_status') reply = { type: 'printer_status', ready: true }
        else if (message.type === 'raw_acceptor') reply = p[1] === 71
          ? { type: 'acceptor_raw', packet: [36, 103, 97, 1, 201] }
          : { type: fault === 'ng' ? 'acceptor_ng' : 'acceptor_ok', data: 0 }
        else if (message.type === 'raw_dispenser') reply = { type: 'dispenser_data', data: p[1] === 73
          ? [36, 105, 0, 0, 105] : [36, 115, 116, fault === 'dispenser_ng' ? 101 : 98, 73] }
        if (reply) for (const listener of [...listeners]) {
          if (message.type === 'raw_dispenser' && fault === 'fragment') {
            listener({ type: 'dispenser_data', data: reply.data.slice(0, 2) })
            listener({ type: 'dispenser_data', data: reply.data.slice(2) })
          } else if (message.type === 'raw_dispenser' && fault === 'checksum')
            listener({ type: 'dispenser_data', data: [...reply.data.slice(0, 4), 0] })
          else listener(reply)
        }
      }, 0)
      return true
    },
  }
  const cardKey = { async autoRecover() { calls.push({ type: 'card_status_capture_reset_status' }); return { success: fault !== 'card_ng', reason: fault === 'card_ng' ? 'card_present' : null } } }
  const terminal = { status: { authenticated: false }, reconnect() { calls.push({ type: 'terminal_reconnect' }); this.status.authenticated = fault !== 'terminal_ng' } }
  const recovery = createDeviceRecovery({ configured, ...profile, bridge, cardKey, terminal, printer: async () => {
    calls.push({ type: 'printer_status' }); if (fault === 'printer_ng') throw Error('printer_unavailable')
  },
    restartServer: async () => { restarts++; bridge.isConnected = true }, isIdle: () => idle,
    canRestartServer: () => restartAllowed ?? idle,
    onBusy: value => busyChanges.push(value),
    now: () => now, sleep: async ms => { now += ms }, setTimeout: scheduleTimeout,
    clearTimeout: id => timers.delete(id), commandTimeoutMs: 15 })
  return { recovery: { ...recovery, reset: target => run(() => recovery.reset(target)), tick: () => run(() => recovery.tick()) },
    calls, bridge, busyChanges, now: () => now, setIdle(value) { idle = value }, setRestartAllowed(value) { restartAllowed = value },
    setFault(value) { fault = value }, advance(ms) { now += ms }, get restarts() { return restarts } }
}

test('all configured devices reset in order after idle without a money, approval or card issue command', async () => {
  const h = fixture()
  h.setIdle(false)
  await assert.rejects(h.recovery.reset('all'), /busy/)
  assert.equal(h.calls.length, 0)
  h.recovery.fault('cardTerminal', 'terminal_unavailable')
  assert.equal(h.recovery.hardware.cardTerminal.state, 'needs_attention')
  h.recovery.ready('cardTerminal')
  assert.equal(h.recovery.hardware.cardTerminal.state, 'ok')
  h.setIdle(true)
  await h.recovery.reset('all')
  assert.deepEqual(Object.values(h.recovery.hardware).map(value => value.state), Array(5).fill('ok'))
  assert.deepEqual(h.busyChanges, [true, false])
  assert.deepEqual(h.calls.map(value => value.type), ['raw_acceptor', 'raw_acceptor', 'raw_acceptor', 'raw_acceptor',
    'raw_dispenser', 'raw_dispenser', 'raw_dispenser', 'terminal_reconnect', 'printer_status', 'card_status_capture_reset_status'])
  assert(h.calls.every(value => !/^(?:dispense|acceptor_return|card_issue|payment|cancel)/.test(value.type)))
})

test('payment yield waits for one outstanding legacy response and stops before reset or money commands', async () => {
  let listener, idle = true
  const sent = [], busy = []
  const recovery = createDeviceRecovery({ configured: ['acceptor'], isIdle: () => idle,
    bridge: { isConnected: true, subscribeMessage(fn) { listener = fn; return () => { listener = null } },
      send(message) { sent.push(message); return true } }, onBusy: value => busy.push(value),
  })
  const resetting = recovery.reset('acceptor')
  idle = false; recovery.requestYield()
  assert.equal(recovery.isBusy(), true)
  assert.equal(sent.length, 1)
  listener({ type: 'acceptor_raw', packet: [36,103,97,1,201] })
  await assert.rejects(resetting, /recovery_yielded/)
  assert.equal(sent.length, 1)
  assert.deepEqual(busy, [true, false])
  assert.equal(recovery.hardware.acceptor.reason, 'awaiting_observation', 'Contention does not invent a device fault')
})

test('integrated recovery sends a yield request, retains the guard until reply, and preserves adapter reason', async () => {
  let listener, idle = true
  const sent = []
  const recovery = createDeviceRecovery({ configured: ['acceptor'], property: 'property3', building: 'B', isIdle: () => idle,
    bridge: { isConnected: true, subscribeMessage(fn) { listener = fn; return () => { listener = null } },
      send(message) { sent.push(message); return true } },
  })
  const resetting = recovery.reset('acceptor')
  idle = false; recovery.requestYield()
  assert.equal(sent[1].type, 'cash_board_yield')
  assert.equal(sent[1].requestId, sent[0].requestId)
  assert.equal(recovery.isBusy(), true)
  listener({ type: 'cash_board_result', target: 'acceptor', requestId: sent[0].requestId,
    success: false, verified: false, source: 'adapter', reason: 'recovery_yielded' })
  await assert.rejects(resetting, /recovery_yielded/)
  idle = true
  const failed = recovery.reset('acceptor')
  listener({ type: 'cash_board_result', target: 'acceptor', requestId: sent[2].requestId,
    success: false, verified: false, source: 'adapter', reason: 'payout_uncertain' })
  await assert.rejects(failed, /adapter:payout_uncertain/)
  assert.equal(recovery.hardware.acceptor.reason, 'adapter:payout_uncertain')
})

for (const profile of [{ property: 'property3', building: 'B' }, { property: 'property4', building: '' }]) {
  test(`${profile.property}/${profile.building}: idle integrated board recovery never sends ONEPLUS, payout or return`, async () => {
    const h = fixture(['acceptor', 'dispenser'], profile)
    h.setIdle(false); await h.recovery.tick(); assert.equal(h.calls.length, 0)
    h.recovery.fault('acceptor'); h.recovery.fault('dispenser')
    h.setIdle(true); await h.recovery.tick()
    assert.deepEqual(h.calls.map(c => c.type), ['ping', 'cash_board_recover', 'cash_board_recover'])
    assert.deepEqual(h.calls.slice(1).map(c => c.target), ['acceptor', 'dispenser'])
    assert.equal(new Set(h.calls.slice(1).map(c => c.requestId)).size, 2)
    assert.deepEqual(Object.values(h.recovery.hardware).map(d => d.state), ['ok', 'ok'])
    assert.equal(h.busyChanges.at(-1), false)
    h.setFault('unverified'); await assert.rejects(h.recovery.reset('acceptor'), /device_ng/)
    assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
    assert.equal(h.recovery.hardware.dispenser.state, 'ok')
    h.setFault('timeout')
    const startedAt = h.now()
    await assert.rejects(h.recovery.reset('acceptor'), /timeout/)
    assert.equal(h.now() - startedAt, 45)
    assert.equal(h.busyChanges.at(-1), false)
    assert(h.calls.every(c => ['ping', 'cash_board_recover'].includes(c.type)))
  })
}

test('NG and timeout latch only the affected device, then idle retry restores it', async () => {
  const h = fixture(['acceptor'])
  h.recovery.fault('acceptor')
  h.setFault('ng')
  await assert.rejects(h.recovery.reset('acceptor'), /device_ng/)
  assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
  h.setFault('timeout'); h.advance(60000)
  await h.recovery.tick()
  assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
  h.setFault(null); h.advance(60000)
  await h.recovery.tick()
  assert.equal(h.recovery.hardware.acceptor.state, 'ok')
  assert(h.calls.every(value => value.type === 'raw_acceptor' || value.type === 'ping'))
})
test('dispenser accepts fragmented status frames but never a bad checksum', async () => {
  const h = fixture(['dispenser'])
  h.setFault('checksum')
  const startedAt = h.now()
  await assert.rejects(h.recovery.reset('dispenser'), /timeout/)
  assert.equal(h.now() - startedAt, 15)
  h.setFault('fragment')
  await h.recovery.reset('dispenser')
  assert.equal(h.recovery.hardware.dispenser.state, 'ok')
})

for (const building of ['C', 'D']) {
  test(`property1/${building}: legacy ONEPLUS replies and a ready Bixolon restore idle recovery to ok`, async () => {
    const h = fixture(['dispenser', 'printer'], { property: 'property1', building })
    h.recovery.fault('dispenser')
    h.setFault('fragment')
    await h.recovery.tick()
    assert.deepEqual(h.calls.map(c => c.type), ['ping', 'raw_dispenser', 'raw_dispenser', 'raw_dispenser', 'printer_status'])
    assert.deepEqual(h.calls.filter(c => c.type === 'raw_dispenser').map(c => c.data), [
      [0x24, 0x53, 0x74, 0x3f, 0x06], // Existing renderer getDispenserStatus: $St?
      [0x24, 0x49, 0x00, 0x00, 0x49], // Existing renderer resetDispenser: $I\0\0
      [0x24, 0x53, 0x74, 0x3f, 0x06],
    ])
    assert.deepEqual(Object.values(h.recovery.hardware).map(d => d.state), ['ok', 'ok'])
    assert.equal(h.busyChanges.at(-1), false)
    assert.equal(h.restarts, 0)
  })
}

for (const [key, failure] of [['dispenser', 'dispenser_ng'], ['cardTerminal', 'terminal_ng'],
  ['printer', 'printer_ng'], ['cardDispenser', 'card_ng']]) {
  test(`${key} failure disables that device until an idle reset succeeds`, async () => {
    const h = fixture([key])
    h.setFault(failure)
    const startedAt = h.now()
    await assert.rejects(h.recovery.reset(key))
    if (key === 'cardTerminal') assert.equal(h.now() - startedAt, 10000)
    assert.equal(h.recovery.hardware[key].state, 'needs_attention')
    h.setFault(null)
    await h.recovery.reset(key)
    assert.equal(h.recovery.hardware[key].state, 'ok')
    assert(h.calls.every(value => !/^(?:dispense|acceptor_return|card_issue|payment|cancel)/.test(value.type)))
  })
}

test('dead bridge restarts only after a sustained idle failure', async () => {
  const h = fixture(['acceptor'])
  h.bridge.isConnected = false
  await h.recovery.tick()
  assert.equal(h.restarts, 0)
  h.advance(29999); await h.recovery.tick()
  assert.equal(h.restarts, 0)
  h.setIdle(false); h.advance(2); await h.recovery.tick()
  assert.equal(h.restarts, 0)
  h.setIdle(true); await h.recovery.tick()
  assert.equal(h.restarts, 1)
  assert.equal(h.recovery.hardware.acceptor.reason, 'awaiting_observation')
})

test('dead bridge restarts once without renderer idle when no transaction is active, but device reset still waits', async () => {
  const h = fixture(['acceptor'])
  h.setIdle(false); h.setRestartAllowed(true); h.bridge.isConnected = false
  await h.recovery.tick(); assert.equal(h.restarts, 0)
  h.advance(30000); await h.recovery.tick(); assert.equal(h.restarts, 1)
  h.advance(60000); await h.recovery.tick(); assert.equal(h.restarts, 1)
  assert(h.calls.every(c => c.type === 'ping'))
  await assert.rejects(h.recovery.reset('acceptor'), /busy/)
  h.setIdle(true); await h.recovery.tick()
  assert.equal(h.recovery.hardware.acceptor.reason, 'awaiting_observation')
})

for (const profile of [{ property: 'property1', building: 'C' }, { property: 'property1', building: 'D' },
  { property: 'property3', building: 'A' }, { property: 'property3', building: 'B' }, { property: 'property4' }]) {
  test(`${profile.property}/${profile.building || ''}: cash probes stay silent until a payment fault, then reset only that device at idle`, async () => {
    const h = fixture(['acceptor', 'dispenser'], profile)
    for (let i = 0; i < 4; i++) { h.advance(60000); await h.recovery.tick() }
    assert(h.calls.every(c => c.type === 'ping'))
    assert.equal(h.recovery.hardware.acceptor.reason, 'awaiting_observation')
    h.recovery.ready('acceptor'); h.recovery.ready('dispenser')
    h.setFault('timeout'); h.advance(60000); await h.recovery.tick()
    assert.deepEqual(Object.values(h.recovery.hardware).map(d => d.state), ['ok', 'ok'], 'ping failure is not a cash fault')
    h.setFault(null); h.advance(60000); await h.recovery.tick()
    h.calls.length = 0
    h.recovery.fault('acceptor', 'payment_stop_failed')
    h.setIdle(false); h.advance(60000); await h.recovery.tick()
    assert.equal(h.calls.length, 0)
    h.setIdle(true); await h.recovery.tick()
    const cashCommands = h.calls.filter(c => c.type !== 'ping')
    if (profile.property === 'property4' || profile.building === 'B') {
      assert.deepEqual(cashCommands.map(c => [c.type, c.target]), [['cash_board_recover', 'acceptor']])
    } else {
      assert.equal(cashCommands.length, 4)
      assert(cashCommands.every(c => c.type === 'raw_acceptor'))
    }
    assert.deepEqual(Object.values(h.recovery.hardware).map(d => d.state), ['ok', 'ok'])
    h.calls.length = 0; h.advance(60000); await h.recovery.tick()
    assert(h.calls.every(c => c.type === 'ping'))
  })
}

test('a failed remote cash reset is reported but does not authorize automatic cash commands', async () => {
  const h = fixture(['dispenser'])
  h.setFault('checksum')
  await assert.rejects(h.recovery.reset('dispenser'), /timeout/)
  const failure = { ...h.recovery.hardware.dispenser }
  h.setFault(null); h.calls.length = 0
  h.advance(60000); await h.recovery.tick()
  assert(h.calls.every(c => c.type === 'ping'))
  assert.deepEqual(h.recovery.hardware.dispenser, failure)
  h.recovery.fault('dispenser', 'payment_payout_failed')
  h.recovery.ready('dispenser')
  h.calls.length = 0; h.advance(60000); await h.recovery.tick()
  assert(h.calls.every(c => c.type === 'ping'), 'a successful payment reply clears the retry evidence')
  assert.equal(h.recovery.hardware.dispenser.state, 'ok')
  assert.equal(h.recovery.hardware.dispenser.lastResetAt, failure.lastResetAt, 'observations do not invent reset timestamps')
})

test('cash availability ignores diagnostic health and ready telemetry cannot clear a real cash block', () => {
  const source = fs.readFileSync(require.resolve('../electron/main'), 'utf8')
  const handlers = {}, global = { kioskCashBlocked: false }
  const h = fixture(['acceptor', 'dispenser'])
  const context = { ipcMain: { handle: (name, fn) => { handlers[name] = fn }, on: (name, fn) => { handlers[name] = fn } },
    deviceRecovery: h.recovery, global, URL }
  vm.runInNewContext(source.slice(source.indexOf("ipcMain.on('device-recovery:fault'"), source.indexOf('const paymentRecovery =')), context)
  vm.runInNewContext(source.slice(source.indexOf("ipcMain.handle('cash:available'"), source.indexOf('const cashDiagnostics =')), context)
  const frame = { url: 'http://localhost:3000/' }, event = { senderFrame: frame, sender: { mainFrame: frame } }
  for (const state of ['recovering', 'ok', 'needs_attention', 'disabled']) {
    h.recovery.hardware.acceptor.state = state; h.recovery.hardware.dispenser.state = state
    assert.equal(handlers['cash:available'](), true)
    global.kioskCashBlocked = true; assert.equal(handlers['cash:available'](), false)
    global.kioskCashBlocked = false
  }
  handlers['device-recovery:fault'](event, 'acceptor')
  handlers['device-recovery:ready']({ ...event, senderFrame: { url: 'https://example.invalid/' } }, 'acceptor')
  assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
  global.kioskCashBlocked = true
  handlers['device-recovery:ready'](event, 'acceptor')
  assert.equal(h.recovery.hardware.acceptor.state, 'ok')
  assert.equal(handlers['cash:available'](), false)
})

test('native recovery subscriptions fan out the same hardware response to the renderer without consuming it', () => {
  class Socket extends EventEmitter { constructor() { super(); this.readyState = 1; Socket.current = this } }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/hardware-server-bridge'), 'utf8'), {
    module, require: name => { assert.equal(name, 'ws'); return Socket }, console: { log() {}, error() {} },
  })
  const bridge = module.exports
  const recoveryMessages = [], rendererMessages = []
  const unsubscribe = bridge.subscribeMessage(message => recoveryMessages.push(message))
  bridge.onMessage(message => rendererMessages.push(message)); bridge.connect()
  for (const message of [{ type: 'dispenser_data', data: [36, 115, 116, 98, 73] },
    { type: 'acceptor_raw', packet: [36, 103, 97, 1, 201] }, { type: 'acceptor_ok', data: 0 }]) {
    Socket.current.emit('message', Buffer.from(JSON.stringify(message)))
  }
  assert.equal(recoveryMessages.length, 3)
  assert.deepEqual(recoveryMessages, rendererMessages)
  unsubscribe()
})

test('active payment journal blocks a dead bridge restart even after the failure threshold', async () => {
  const h = fixture(['acceptor'])
  h.setIdle(false); h.setRestartAllowed(true); h.bridge.isConnected = false
  await h.recovery.tick()
  h.setRestartAllowed(false); h.advance(60000)
  await h.recovery.tick(); await assert.rejects(h.recovery.reset('hardwareServer'), /busy/)
  assert.equal(h.restarts, 0)
  assert.equal(h.calls.length, 0)
  h.setRestartAllowed(true); await h.recovery.tick(); assert.equal(h.restarts, 1)
})

test('restart failures respect backoff outside the first screen', async () => {
  const h = fixture(['acceptor'])
  h.setIdle(false); h.setRestartAllowed(true); h.setFault('timeout')
  await h.recovery.tick(); h.advance(30000); await h.recovery.tick()
  assert.equal(h.restarts, 1)
  h.advance(59000); await h.recovery.tick(); assert.equal(h.restarts, 1)
  h.advance(1000); await h.recovery.tick(); assert.equal(h.restarts, 2)
  assert.equal(h.busyChanges.at(-1), false)
})

test('an overlay with no native devices never probes or restarts a phantom hardware server', async () => {
  const h = fixture([])
  h.bridge.isConnected = false
  for (let i = 0; i < 6; i++) { h.advance(60000); await h.recovery.tick() }
  assert.deepEqual(h.recovery.hardware, {})
  assert.equal(h.calls.length, 0); assert.equal(h.restarts, 0)
  await assert.rejects(h.recovery.reset('printer'), /device_unconfigured/)
})

test('remote reset waits for idle, expires busy, and executes a command ID once across restarts', async () => {
  const h = fixture(['cardDispenser'])
  const records = new Map(), store = { read: id => records.get(id), write: (id, value) => records.set(id, value) }
  const request = { id: '0e7a801b-0294-47e5-a593-52d83e7d0a4e', device: 'cardDispenser', expiresAt: 1120000 }
  h.setIdle(false)
  await assert.rejects(runRemoteReset(request, store, h.recovery, () => false, () => 1000000), /busy/)
  assert.equal(records.size, 0)
  h.setIdle(true)
  await runRemoteReset(request, store, h.recovery, () => true, () => 1000000)
  await runRemoteReset(request, store, h.recovery, () => true, () => 1000000)
  assert.equal(h.calls.filter(value => value.type === 'card_status_capture_reset_status').length, 1)
  assert.equal([...records.values()][0].status, 'completed')
  await assert.rejects(runRemoteReset({ ...request, id: 'another', expiresAt: 999999 }, store, h.recovery, () => true, () => 1000000), /busy/)
  assert.equal(records.size, 1)
})

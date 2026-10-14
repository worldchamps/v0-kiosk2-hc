const test = require('node:test')
const assert = require('node:assert/strict')
const { createDeviceRecovery, runRemoteReset } = require('../electron/device-recovery')
const packet = (a, b, c) => [0x24, a, b, c, (a + b + c) & 0xff]

function fixture(configured = ['acceptor', 'dispenser', 'cardTerminal', 'printer', 'cardDispenser'], profile = {}) {
  const calls = [], listeners = new Set(), busyChanges = [], timers = new Map()
  let dispenserReplies = []
  let idle = true, now = 1000000, fault = null, restarts = 0, timerId = 0
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
        else if (message.type === 'raw_dispenser') {
          const data = dispenserReplies.length ? dispenserReplies.shift() : p[1] === 73
            ? packet(0x69, 0, 0x61) : fault === 'dispenser_ng' ? packet(0x73, 0, 0x6e) : packet(0x73, 0x74, 0x62)
          if (data) reply = { type: 'dispenser_data', data }
        }
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
    onBusy: value => busyChanges.push(value),
    now: () => now, sleep: async ms => { now += ms }, setTimeout: scheduleTimeout,
    clearTimeout: id => timers.delete(id), commandTimeoutMs: 15 })
  return { recovery: { ...recovery, reset: target => run(() => recovery.reset(target)) },
    calls, bridge, busyChanges, now: () => now, setIdle(value) { idle = value }, setFault(value) { fault = value },
    setDispenserReplies(...replies) { dispenserReplies = replies }, advance(ms) { now += ms }, get restarts() { return restarts } }
}

test('creation, idle time and observed faults never probe or reset devices', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const h = fixture()
  const initial = Object.fromEntries(Object.keys(h.recovery.hardware).map(key => [key,
    { state: 'ok', reason: null, lastResetAt: null, lastResetResult: null }]))
  assert.deepEqual(h.recovery.hardware, initial)
  assert.equal('tick' in h.recovery, false)
  h.advance(600000); t.mock.timers.tick(600000)
  assert.deepEqual(h.recovery.hardware, initial)
  h.recovery.fault('acceptor', 'device_error')
  h.bridge.isConnected = false
  h.setIdle(false); h.advance(600000); t.mock.timers.tick(600000)
  h.setIdle(true); h.advance(600000); t.mock.timers.tick(600000)
  assert.deepEqual(h.recovery.hardware, { ...initial,
    acceptor: { ...initial.acceptor, state: 'needs_attention', reason: 'device_error' } })
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.busyChanges, [])
  assert.equal(h.recovery.isBusy(), false)
  assert.equal(h.restarts, 0)
})

test('main has no recovery tick call or recovery interval', () => {
  const fs = require('node:fs'), path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  assert.doesNotMatch(source, /\bdeviceRecovery(?:\?\.|\.)tick\b/)
  assert.doesNotMatch(source, /\bsetInterval\s*\([^;\n]*\bdeviceRecovery\b/)
  const idleHandler = source.slice(source.indexOf("ipcMain.on('card-key:idle'"), source.indexOf("ipcMain.on('card-key:idle'") + 400)
  assert.match(idleHandler, /cardRendererIdle = value === true/)
})

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

for (const profile of [{ property: 'property3', building: 'B' }, { property: 'property4', building: '' }]) {
  test(`${profile.property}/${profile.building}: PMS integrated board reset never sends ONEPLUS, payout or return`, async () => {
    const h = fixture(['acceptor', 'dispenser'], profile)
    h.setIdle(false); await assert.rejects(h.recovery.reset('all'), /busy/); assert.equal(h.calls.length, 0)
    h.setIdle(true); await h.recovery.reset('all')
    assert.deepEqual(h.calls.map(c => c.type), ['cash_board_recover', 'cash_board_recover'])
    assert.deepEqual(h.calls.map(c => c.target), ['acceptor', 'dispenser'])
    assert.equal(new Set(h.calls.map(c => c.requestId)).size, 2)
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
    assert(h.calls.every(c => c.type === 'cash_board_recover'))
  })
}

test('NG and timeout latch only the affected device, then a later PMS reset restores it', async () => {
  const h = fixture(['acceptor', 'dispenser'])
  h.setFault('ng')
  await assert.rejects(h.recovery.reset('acceptor'), /device_ng/)
  assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
  assert.equal(h.recovery.hardware.dispenser.state, 'ok')
  h.setFault('timeout'); h.advance(60000)
  await assert.rejects(h.recovery.reset('acceptor'), /timeout/)
  assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
  assert.equal(h.recovery.hardware.dispenser.state, 'ok')
  h.setFault(null); h.advance(60000)
  await h.recovery.reset('acceptor')
  assert.equal(h.recovery.hardware.acceptor.state, 'ok')
  assert.equal(h.recovery.hardware.dispenser.lastResetAt, null)
  assert(h.calls.every(value => value.type === 'raw_acceptor'))
})
test('dispenser accepts fragmented status frames but never a bad checksum', async () => {
  const h = fixture(['dispenser'])
  h.setFault('checksum')
  const startedAt = h.now()
  await assert.rejects(h.recovery.reset('dispenser'), /timeout/)
  assert.equal(h.now() - startedAt, 30)
  assert.equal(h.calls.filter(c => c.data?.[1] === 0x49).length, 1)
  h.setFault('fragment')
  await h.recovery.reset('dispenser')
  assert.equal(h.recovery.hardware.dispenser.state, 'ok')
})

for (const building of ['C', 'D']) {
  test(`property1/${building}: PMS reset verifies legacy ONEPLUS replies and a ready Bixolon`, async () => {
    const h = fixture(['dispenser', 'printer'], { property: 'property1', building })
    h.setFault('fragment')
    await h.recovery.reset('all')
    assert.deepEqual(h.calls.map(c => c.type), ['raw_dispenser', 'raw_dispenser', 'raw_dispenser', 'printer_status'])
    assert.deepEqual(h.calls.filter(c => c.type === 'raw_dispenser').map(c => c.data), [
      [0x24, 0x53, 0x00, 0x00, 0x53], // Spec #9: $S\0\0
      [0x24, 0x49, 0x00, 0x00, 0x49], // Spec #2: $I\0\0
      [0x24, 0x53, 0x00, 0x00, 0x53],
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

test('PMS hardware-server reset defaults to the idle guard and verifies the restarted bridge', async () => {
  const h = fixture(['acceptor'])
  h.bridge.isConnected = false
  h.recovery.fault('acceptor', 'bridge_disconnected')
  h.setIdle(false)
  await assert.rejects(h.recovery.reset('hardwareServer'), /busy/)
  assert.equal(h.restarts, 0)
  h.setIdle(true)
  h.setFault('timeout')
  await assert.rejects(h.recovery.reset('hardwareServer'), /timeout/)
  assert.equal(h.restarts, 1)
  assert.equal(h.recovery.isBusy(), false)
  h.setFault(null)
  await h.recovery.reset('hardwareServer')
  assert.equal(h.restarts, 2)
  assert.deepEqual(h.calls.map(c => c.type), ['ping', 'ping'])
  assert.equal(h.recovery.hardware.acceptor.state, 'needs_attention')
  assert.deepEqual(h.busyChanges, [true, false, true, false])
})

test('PMS server reset uses its own guard while device resets still require the idle screen', async () => {
  let canRestart = true
  const h = fixture(['acceptor'], { canRestartServer: () => canRestart })
  h.setIdle(false)
  await assert.rejects(h.recovery.reset('acceptor'), /busy/)
  await assert.rejects(h.recovery.reset('all'), /busy/)
  assert.equal(h.calls.length, 0)
  const restarting = h.recovery.reset('hardwareServer')
  await assert.rejects(h.recovery.reset('hardwareServer'), /busy/)
  await restarting
  assert.equal(h.restarts, 1)
  assert.deepEqual(h.calls.map(c => c.type), ['ping'])
  canRestart = false; h.setIdle(true)
  await assert.rejects(h.recovery.reset('hardwareServer'), /busy/)
  assert.equal(h.restarts, 1)
  assert.deepEqual(h.busyChanges, [true, false])
})

for (const ready of [packet(0x73, 0x74, 0x62), packet(0x73, 2, 0x6f), packet(0x53, 250, 0x6f)]) {
  test(`PMS dispenser reset accepts ready status ${ready.slice(1, 4)} before and after init`, async () => {
    const h = fixture(['dispenser'])
    h.setDispenserReplies(ready, packet(0x69, 0, 0x61), ready)
    await h.recovery.reset('dispenser')
    assert.deepEqual(h.calls.map(c => c.data), [packet(0x53, 0, 0), packet(0x49, 0, 0), packet(0x53, 0, 0)])
    assert.equal(h.recovery.hardware.dispenser.state, 'ok')
    assert.equal(h.restarts, 0)
  })
}

for (const status of [packet(0x73, 0x6f, 0x6e), packet(0x53, 0x6f, 0x6e)]) {
  test(`PMS dispenser reset rejects active dispensing ${status.slice(1, 4)} without sending init`, async () => {
    const h = fixture(['dispenser'])
    h.setDispenserReplies(status)
    await assert.rejects(h.recovery.reset('dispenser'), /dispenser_busy/)
    assert.deepEqual(h.calls.map(c => c.data), [packet(0x53, 0, 0)])
    assert.equal(h.recovery.hardware.dispenser.state, 'needs_attention')
    assert.equal(h.recovery.hardware.dispenser.reason, 'dispenser_busy')
    assert.equal(h.recovery.isBusy(), false)
  })
}

for (const status of [null, packet(0x73, 0x68, 0x21), packet(0x73, 0, 0x6e), packet(0x73, 2, 0x6e),
  ...[0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x8a, 0x8c, 0x8e].map(code => packet(0x73, 0x65, code))]) {
  test(`PMS dispenser reset recovers non-moving status ${status?.slice(1, 4) || 'no response'}`, async () => {
    const h = fixture(['dispenser'])
    h.setDispenserReplies(status, packet(0x69, 0, 0x61), packet(0x73, 0x74, 0x62))
    await h.recovery.reset('dispenser')
    assert.deepEqual(h.calls.map(c => c.data), [packet(0x53, 0, 0), packet(0x49, 0, 0), packet(0x53, 0, 0)])
    assert.equal(h.recovery.hardware.dispenser.state, 'ok')
    assert.equal(h.recovery.isBusy(), false)
  })
}

for (const [label, replies, reason, count] of [
  ['reset refused', [packet(0x73, 0x74, 0x62), packet(0x6e, 0x73, 0x21)], 'device_ng', 2],
  ['reset refused from error stop', [packet(0x73, 0, 0x6e), packet(0x6e, 0x73, 0x21)], 'device_ng', 2],
  ['wrong init acknowledgement', [packet(0x73, 0x74, 0x62), packet(0x69, 0, 0)], 'dispenser_reset_failed', 2],
  ['not ready after init', [packet(0x73, 0x74, 0x62), packet(0x69, 0, 0x61), packet(0x73, 2, 0x6e)], 'dispenser_not_ready', 3],
]) {
  test(`PMS dispenser reset fails closed on ${label} without retrying`, async () => {
    const h = fixture(['dispenser'])
    h.setDispenserReplies(...replies)
    await assert.rejects(h.recovery.reset('dispenser'), new RegExp(reason))
    assert.equal(h.calls.length, count)
    assert.equal(h.recovery.hardware.dispenser.state, 'needs_attention')
    assert.equal(h.recovery.hardware.dispenser.lastResetResult, reason)
    assert.equal(h.recovery.isBusy(), false)
  })
}

test('an overlay with no native devices never probes or restarts a phantom hardware server', async () => {
  const h = fixture([])
  h.bridge.isConnected = false
  h.advance(600000)
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

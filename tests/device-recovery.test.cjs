const test = require('node:test')
const assert = require('node:assert/strict')
const { createDeviceRecovery, runRemoteReset } = require('../electron/device-recovery')

function fixture(configured = ['acceptor', 'dispenser', 'cardTerminal', 'printer', 'cardDispenser']) {
  const calls = [], listeners = new Set(), busyChanges = []
  let idle = true, now = 1000000, fault = null, restarts = 0
  const bridge = { isConnected: true,
    subscribeMessage(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    send(message) {
      calls.push(message)
      if (!bridge.isConnected) return false
      setImmediate(() => {
        if (fault === 'timeout') return
        const p = message.data
        let reply
        if (message.type === 'ping') reply = { type: 'pong' }
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
      })
      return true
    },
  }
  const cardKey = { async autoRecover() { calls.push({ type: 'card_status_capture_reset_status' }); return { success: fault !== 'card_ng', reason: fault === 'card_ng' ? 'card_present' : null } } }
  const terminal = { status: { authenticated: false }, reconnect() { calls.push({ type: 'terminal_reconnect' }); this.status.authenticated = fault !== 'terminal_ng' } }
  const recovery = createDeviceRecovery({ configured, bridge, cardKey, terminal, printer: async () => {
    calls.push({ type: 'printer_status' }); if (fault === 'printer_ng') throw Error('printer_unavailable')
  },
    restartServer: async () => { restarts++; bridge.isConnected = true }, isIdle: () => idle,
    onBusy: value => busyChanges.push(value),
    now: () => now, sleep: async ms => { now += ms }, commandTimeoutMs: 15 })
  return { recovery, calls, bridge, busyChanges, setIdle(value) { idle = value }, setFault(value) { fault = value }, advance(ms) { now += ms }, get restarts() { return restarts } }
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

test('NG and timeout latch only the affected device, then idle retry restores it', async () => {
  const h = fixture(['acceptor'])
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
  await assert.rejects(h.recovery.reset('dispenser'), /timeout/)
  h.setFault('fragment')
  await h.recovery.reset('dispenser')
  assert.equal(h.recovery.hardware.dispenser.state, 'ok')
})

for (const [key, failure] of [['dispenser', 'dispenser_ng'], ['cardTerminal', 'terminal_ng'],
  ['printer', 'printer_ng'], ['cardDispenser', 'card_ng']]) {
  test(`${key} failure disables that device until an idle reset succeeds`, async () => {
    const h = fixture([key])
    h.setFault(failure)
    await assert.rejects(h.recovery.reset(key))
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
  h.setIdle(false); h.advance(30001); await h.recovery.tick()
  assert.equal(h.restarts, 0)
  h.setIdle(true); await h.recovery.tick()
  assert.equal(h.restarts, 1)
  assert.equal(h.recovery.hardware.acceptor.state, 'ok')
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

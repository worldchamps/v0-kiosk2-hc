const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { attachRendererRecovery } = require('../electron/renderer-recovery')

function fixture() {
  let now = 0, id = 0
  const timers = new Map(), loads = [], faults = [], crashes = []
  const window = new EventEmitter(), contents = new EventEmitter()
  Object.assign(window, { webContents: contents, isDestroyed: () => !!window.closed,
    loadURL: async url => { loads.push({ url, at: now }) } })
  contents.isDestroyed = () => !!window.closed
  contents.forcefullyCrashRenderer = () => { crashes.push(now); contents.emit('render-process-gone') }
  attachRendererRecovery(window, { startUrl: 'http://localhost:3000?mode=kiosk&home=true', onFault: code => faults.push(code),
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id }, clearTimeout: id => timers.delete(id) })
  function advance(ms) {
    const until = now + ms
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= until).sort(([, a], [, b]) => a.at - b.at)[0]
      if (!next) break
      now = next[1].at; timers.delete(next[0]); next[1].fn()
    }
    now = until
  }
  return { window, contents, loads, faults, timers, crashes, advance }
}

test('renderer crash returns to the entry URL, deduplicates events and backs off until a stable minute', () => {
  const h = fixture()
  h.contents.emit('render-process-gone'); h.contents.emit('render-process-gone')
  h.advance(999); assert.equal(h.loads.length, 0)
  h.advance(1); assert.equal(h.loads.length, 1)
  assert.equal(h.loads[0].url, 'http://localhost:3000?mode=kiosk&home=true')
  h.contents.emit('did-finish-load'); h.advance(1000); h.contents.emit('render-process-gone')
  h.advance(4999); assert.equal(h.loads.length, 1)
  h.advance(1); assert.equal(h.loads.length, 2)
  h.contents.emit('did-finish-load'); h.advance(60000); h.contents.emit('render-process-gone')
  h.advance(1000); assert.equal(h.loads.length, 3)
  assert.deepEqual(h.faults, Array(3).fill('ui_renderer_gone'))
})

test('unresponsive must last ten seconds; responsive cancels recovery before a reload', () => {
  const h = fixture()
  h.window.emit('unresponsive'); h.advance(9999); h.window.emit('responsive'); h.advance(10000)
  assert.equal(h.loads.length, 0); assert.equal(h.faults.length, 0)
  h.window.emit('unresponsive'); h.advance(10000); assert.equal(h.loads.length, 0)
  h.window.emit('responsive'); h.advance(1000); assert.equal(h.loads.length, 0)
  h.window.emit('unresponsive'); h.advance(15000); assert.equal(h.loads.length, 1)
  assert.equal(h.crashes.length, 1); assert.equal(h.timers.size, 0, 'intentional crash cannot queue a duplicate reload')
})

test('failed main-frame loads retry, ignore navigation cancellation and cancel all work on close', () => {
  const h = fixture()
  h.contents.emit('did-fail-load', {}, -3, '', '', true)
  h.contents.emit('did-fail-load', {}, -2, '', '', false)
  assert.equal(h.timers.size, 0)
  h.contents.emit('did-fail-load', {}, -2, '', '', true); h.advance(1000)
  assert.equal(h.loads.length, 1)
  h.contents.emit('did-finish-load'); h.window.emit('unresponsive'); h.window.closed = true; h.window.emit('closed')
  assert.equal(h.timers.size, 0); h.advance(300000); assert.equal(h.loads.length, 1)
})

test('actual main-process guard keeps unknown/active journals and card/command/recovery activity blocked', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const code = source.slice(source.indexOf('let cardRendererIdle ='), source.indexOf('const cardStore ='))
  const handlers = {}, webContents = { mainFrame: { url: 'http://localhost:3000' } }
  let cardBusy = false, cardStatus = {}, operations = 0, windowAlive = true
  const context = { global: {}, Date: { now: () => 100000 }, URL, OVERLAY_MODE: false, lastAcceptorCommand: 0,
    getOperationsWindow: () => windowAlive ? { webContents } : null,
    ipcMain: { on: (name, fn) => handlers[name] = fn }, tossFrontBridge: { pending: new Set() },
    cardKey: { isBusy: () => cardBusy, status: () => cardStatus } }
  vm.createContext(context)
  vm.runInContext(code + '; global.canRestart = canRestartServer; global.autoIdle = cardAutoIdle', context)
  const canRestart = context.global.canRestart
  assert.equal(canRestart(), false, 'unknown journal fails closed')
  const event = () => ({ sender: webContents, senderFrame: webContents.mainFrame })
  const report = blocked => { const e = event(); handlers['payment-recovery:device-blocked'](e, blocked); return e.returnValue }
  assert.equal(report(false), true); assert.equal(canRestart(), true)
  assert.equal(!!context.global.autoIdle(), false, 'administrator/non-idle screen still blocks device resets')
  report(true); windowAlive = false; assert.equal(canRestart(), false, 'a dead renderer retains its active journal guard')
  windowAlive = true; report(false); windowAlive = false; assert.equal(canRestart(), true)
  windowAlive = true
  for (const key of ['kioskMaintenance', 'kioskPaymentRecoveryActive', 'kioskHttpActive', 'kioskCardBusy']) {
    context.global[key] = true; assert.equal(canRestart(), false, key); context.global[key] = false
  }
  context.global.kioskActiveOperations = () => operations
  operations = 1; assert.equal(canRestart(), false); operations = 0
  context.tossFrontBridge.pending.add('payment'); assert.equal(canRestart(), false); context.tossFrontBridge.pending.clear()
  cardBusy = true; assert.equal(canRestart(), false); cardBusy = false
  for (const state of [{ recoveryRequired: true }, { reason: 'card_present' }, { reason: 'moving' }]) {
    cardStatus = state; assert.equal(canRestart(), false)
  }
  cardStatus = {}; context.lastAcceptorCommand = 95000; assert.equal(canRestart(), false); context.lastAcceptorCommand = 0
  report(true)
  handlers['payment-recovery:device-blocked']({ ...event(), senderFrame: {} }, false)
  assert.equal(canRestart(), false, 'subframes cannot clear the journal guard')
  handlers['payment-recovery:device-blocked'](event(), 'false'); assert.equal(canRestart(), false)
  context.global.kioskDeviceRecoveryActive = true; assert.equal(report(true), false, 'new payment cannot start during recovery')
})

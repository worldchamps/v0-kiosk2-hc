const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

function harness(property = 'property2', bounds = { x: -1280, y: 20, width: 1280, height: 720 }, { fsImpl, userData = '', shellThrows = false } = {}) {
  const shell = []
  const windows = [], timers = new Set(), intervals = new Set(), ipcMain = new EventEmitter()
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = options.show !== false; this.focusCount = 0
      this.sent = []; this.webContents = new EventEmitter()
      Object.assign(this.webContents, { mainFrame: {}, session: { webRequest: { onHeadersReceived() {} } },
        isDestroyed: () => !!this.destroyed, isLoading: () => false,
        send: (...args) => this.sent.push(args), setZoomFactor() {} })
      windows.push(this)
    }
    loadFile(file, options) { this.file = file; this.loadOptions = options }
    async loadURL(url) { this.url = url }
    isDestroyed() { return !!this.destroyed }
    isVisible() { return this.visible }
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    close() { if (this.options.closable !== false) this.destroy() }
    destroy() { this.destroyed = true; this.emit('closed') }
    focus() { this.focusCount++ }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} moveTop() {} setIgnoreMouseEvents() {}
  }
  const context = { Buffer, module: { exports: {} }, __dirname: path.join(__dirname, '../electron'), global: {},
    process: { env: { NODE_ENV: 'production', KIOSK_PROPERTY_ID: property } }, console: { log() {}, error() {} },
    setTimeout: fn => { timers.add(fn); return fn }, clearTimeout: fn => timers.delete(fn), setInterval: fn => { intervals.add(fn); return fn }, clearInterval: fn => intervals.delete(fn),
    require: name => name === 'electron' ? { BrowserWindow: Window, ipcMain, screen: { getPrimaryDisplay: () => ({ bounds }) }, app: { getPath: () => userData } }
      : name === 'node:child_process' ? { execFile: (...args) => { if (shellThrows) throw Error('spawn EPERM'); shell.push(args) } }
      : name === 'node:fs' ? fsImpl || { appendFileSync() {} }
      : name === './renderer-recovery' ? require('../electron/renderer-recovery') : require(name) }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/overlay-button.js'), 'utf8'), context)
  const api = context.module.exports, button = api.createOverlayButton()
  button.webContents.emit('did-finish-load')
  return { api, button, windows, context, intervals, timers, shell, tick: () => intervals.forEach(fn => fn()),
    send: (channel, window = button, frame = window.webContents.mainFrame) => ipcMain.emit(channel, { sender: window.webContents, senderFrame: frame }) }
}

test('Kariv banner stays above room tabs, respects display origin, and never takes vendor focus', () => {
  for (const [width, height] of [[1280,720], [1920,1080], [1024,600], [853,480]]) {
    const h = harness('property2', { x: -width, y: 20, width, height })
    const b = h.button.options
    assert(b.x >= -width && b.x + b.width <= 0)
    assert(b.y >= 20 && b.y + b.height <= 20 + height * .14)
    assert.equal(b.focusable, false)
    h.tick(); h.tick()
    assert.equal(h.button.focusCount, 0)
    assert.equal(h.api.isIdleButtonSender(h.button.webContents), true)
    assert.equal(h.button.loadOptions.query.layout, 'banner')
  }
})

test('popup opens once from the visible button, and closes back to idle without touching vendor windows', () => {
  const h = harness()
  h.send('overlay-button-clicked')
  const popup = h.windows[1]
  assert.equal(h.api.isIdleButtonSender(h.button.webContents), false)
  assert.equal(popup.options.x, -1280)
  assert.equal(popup.options.y, 20)
  popup.webContents.emit('did-finish-load')
  h.tick(); h.send('overlay-button-clicked')
  assert.equal(h.windows.length, 2)
  assert.equal(popup.focusCount, 1)
  h.send('close-popup') // Wrong sender cannot interrupt a check-in.
  assert.equal(popup.isDestroyed(), false)
  h.send('close-popup', popup)
  assert.equal(h.button.visible, true)
  assert.equal(h.api.isIdleButtonSender(h.button.webContents), true)
  h.tick(); assert.equal(h.button.focusCount, 0)
  assert.deepEqual(h.button.sent.map(args => [...args]), [['kiosk:overlay-idle',true], ['kiosk:overlay-idle',false], ['kiosk:overlay-idle',true]])
  h.send('overlay-button-clicked')
  h.send('checkin-complete', h.windows[2])
  assert.equal(h.api.isIdleButtonSender(h.button.webContents), true)
})

test('untrusted subframes and update maintenance cannot launch the overlay popup', () => {
  const h = harness()
  h.send('overlay-button-clicked', h.button, {})
  assert.equal(h.windows.length, 1)
  h.context.global.kioskMaintenance = true
  h.send('overlay-button-clicked')
  assert.equal(h.windows.length, 1)
})

test('other legacy overlay properties retain the compact window', () => {
  const h = harness('property1')
  assert.equal(h.button.options.width, 200)
  assert.equal(h.button.options.height, 125)
  assert.equal(h.button.loadOptions.query.layout, 'compact')
})

test('exit destroys the non-closable banner and its keeper, even while a popup is open', () => {
  for (const popupOpen of [false, true]) {
    const h = harness()
    h.button.close()
    assert.equal(h.button.isDestroyed(), false, 'guests still cannot close the banner')
    if (popupOpen) {
      h.send('overlay-button-clicked')
      h.windows[1].webContents.emit('did-finish-load')
      assert.equal(h.api.getKioskPopup(), h.windows[1])
    }
    assert.equal(h.intervals.size, 1)
    h.api.destroyOverlayButton(); h.api.destroyOverlayButton()
    assert.equal(h.button.isDestroyed(), true)
    assert.equal(h.intervals.size, 0)
    if (popupOpen) h.windows[1].close()
    assert.equal(h.intervals.size, 0, 'popup close cannot revive the destroyed banner')
    assert.equal(h.api.getKioskPopup(), null)
    assert.equal(h.api.isIdleButtonSender(h.button.webContents), false)
  }
})

test('popup that never loads is dropped by the watchdog and the idle button returns; a loaded popup is kept', () => {
  const h = harness()
  h.send('overlay-button-clicked')
  const stuck = h.windows[1]
  assert.equal(h.timers.size, 1)
  h.timers.forEach(fn => fn())
  assert.equal(stuck.isDestroyed(), true)
  assert.equal(h.button.visible, true)
  assert.equal(h.api.isIdleButtonSender(h.button.webContents), true)
  h.send('overlay-button-clicked')
  const ok = h.windows[2]
  ok.webContents.emit('did-finish-load')
  assert.equal(h.timers.size, 0)
  assert.equal(ok.isDestroyed(), false)
})

test('idle button hidden without a popup is shown again by the keeper', () => {
  const h = harness()
  h.button.hide()
  h.tick()
  assert.equal(h.button.visible, true)
})

test('Kariv records visible programs once and ships only new popup diagnostics', () => {
  const fs = require('node:fs'), os = require('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-log-'))
  try {
    const h = harness('property2', undefined, { fsImpl: fs, userData: dir })
    assert.equal(h.shell.length, 1)
    assert.equal(h.shell[0][0], 'powershell.exe')
    assert.equal(harness('property1').shell.length, 0, 'legacy overlay does not probe other programs')
    assert.equal(h.api.readPopupLogUpdate(), null, 'no log yet')
    h.send('overlay-button-clicked')
    const first = h.api.readPopupLogUpdate()
    assert.match(first, /\[OVERLAY_POPUP\] loading/)
    assert.equal(h.api.readPopupLogUpdate(), null, 'unchanged log is not resent')
    fs.appendFileSync(path.join(dir, 'overlay-popup.log'), 'x'.repeat(9000))
    fs.utimesSync(path.join(dir, 'overlay-popup.log'), new Date(), new Date(Date.now() + 5000))
    assert.equal(h.api.readPopupLogUpdate().length, 4000, 'only the tail fits in a device report')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a blocked PowerShell probe never stops the Kariv banner from starting', () => {
  const h = harness('property2', undefined, { shellThrows: true })
  assert.equal(h.button.visible, true)
  assert.equal(h.api.isIdleButtonSender(h.button.webContents), true)
})

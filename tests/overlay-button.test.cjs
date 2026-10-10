const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

function harness(property = 'property2', bounds = { x: -1280, y: 20, width: 1280, height: 720 }) {
  const windows = [], intervals = new Set(), ipcMain = new EventEmitter()
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = options.show !== false; this.focusCount = 0
      this.sent = []; this.webContents = new EventEmitter()
      Object.assign(this.webContents, { mainFrame: {}, session: { webRequest: { onHeadersReceived() {} } },
        send: (...args) => this.sent.push(args), setZoomFactor() {} })
      windows.push(this)
    }
    loadFile(file, options) { this.file = file; this.loadOptions = options }
    async loadURL(url) { this.url = url }
    isDestroyed() { return !!this.destroyed }
    isVisible() { return this.visible }
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    close() { this.destroyed = true; this.emit('closed') }
    focus() { this.focusCount++ }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} moveTop() {} setIgnoreMouseEvents() {}
  }
  const context = { module: { exports: {} }, __dirname: path.join(__dirname, '../electron'), global: {},
    process: { env: { NODE_ENV: 'production', KIOSK_PROPERTY_ID: property } }, console: { log() {}, error() {} },
    setInterval: fn => { intervals.add(fn); return fn }, clearInterval: fn => intervals.delete(fn),
    require: name => name === 'electron' ? { BrowserWindow: Window, ipcMain, screen: { getPrimaryDisplay: () => ({ bounds }) }, app: { getPath: () => '' } }
      : name === 'node:fs' ? { appendFileSync() {} } : require(name) }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/overlay-button.js'), 'utf8'), context)
  const api = context.module.exports, button = api.createOverlayButton()
  button.webContents.emit('did-finish-load')
  return { api, button, windows, context, tick: () => intervals.forEach(fn => fn()),
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

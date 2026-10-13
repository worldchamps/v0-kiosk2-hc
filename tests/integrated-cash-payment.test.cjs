const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the real payment polling callback with synthetic device replies and journal callbacks.
test('integrated cash never books small/unknown notes; large notes and individual ONEPLUS amounts retain their mapping', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/payment-screen.tsx'), 'utf8')
  const start = source.indexOf('  const pollDeviceStatus = useCallback(')
  const end = source.indexOf('  useEffect(', start)
  assert(start >= 0 && end > start)
  const compiled = ts.transpileModule(source.slice(start, end) + '\nexports.poll = pollDeviceStatus', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  for (const integrated of [true, false]) {
    for (const [code, amount] of [[0x01, 1000], [0x05, 5000], [0x0a, 10000], [0x32, 50000], [0xff, null]]) {
      const amounts = [], recoveries = []; let enabled = 0, completed = 0
      const context = { exports: {}, useCallback: fn => fn, largeBillsOnly: integrated,
        isPollingProcessingRef: { current: false }, paymentCompleteRef: { current: false }, cancellingRef: { current: false },
        latestSession: { current: { acceptedAmount: 0 } }, requiredAmount: 60000,
        getStatus: async () => 0x0b, getBillData: async () => code,
        addBill: value => amounts.push(value), requireRecovery: value => recoveries.push(value),
        handlePaymentCompletion: async () => { completed++ }, enableAcceptance: async () => { enabled++; return true },
        setStatusMessage() {}, setTimeout: fn => { fn(); return 1 }, console: { log() {}, warn() {}, error() {} },
      }
      vm.runInNewContext(compiled, context)
      await context.exports.poll()
      const allowed = amount !== null && (!integrated || amount >= 10000)
      assert.deepEqual(amounts, allowed ? [amount] : [])
      assert.equal(recoveries.length, allowed ? 0 : 1)
      assert.equal(enabled, allowed ? 1 : 0)
      assert.equal(completed, 0)
      assert.equal(context.isPollingProcessingRef.current, false)
    }
  }
})

test('cash backend comes from the native property and building identity', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const block = source.slice(source.indexOf('ipcMain.handle("get-hardware-status"'), source.indexOf('ipcMain.handle("disconnect-printer"'))
  for (const [property, building, expected] of [['property3', 'B', 'bac2400'], ['property4', '', 'bac2400'],
    ['property3', 'A', 'oneplus'], ['property1', 'C', 'oneplus'], ['property1', 'D', 'oneplus'], ['property2', '', 'oneplus']]) {
    let handler
    vm.runInNewContext(block, { ipcMain: { handle: (_name, fn) => { handler = fn } },
      hardwareBridge: { isConnected: true }, KIOSK_PROPERTY_ID: property, process: { env: { KIOSK_BUILDING: building } },
      cashBoardInfo: null, ...require('../electron/cash-device-profile'),
    })
    assert.equal((await handler()).cashBackend, expected)
  }
})

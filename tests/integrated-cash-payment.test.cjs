const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the real payment polling callback with synthetic device replies and journal callbacks.
test('MULTI3400 credits all stacked notes; Camp retains its denomination restriction and ONEPLUS mapping', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/payment-screen.tsx'), 'utf8')
  const start = source.indexOf('  const pollDeviceStatus = useCallback(')
  const end = source.indexOf('  useEffect(', start)
  assert(start >= 0 && end > start)
  const compiled = ts.transpileModule(source.slice(start, end) + '\nexports.poll = pollDeviceStatus', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  for (const backend of ['multi3400', 'bac2400', 'oneplus']) {
    for (const [code, amount] of [[0x01, 1000], [0x05, 5000], [0x0a, 10000], [0x32, 50000], [0xff, null]]) {
      const amounts = [], recoveries = []; let enabled = 0, completed = 0
      const codes = [code, 0]
      const context = { exports: {}, useCallback: fn => fn, largeBillsOnly: backend === 'bac2400', multi3400: backend === 'multi3400',
        isPollingProcessingRef: { current: false }, paymentCompleteRef: { current: false }, cancellingRef: { current: false },
        latestSession: { current: { acceptedAmount: 0 } }, requiredAmount: 60000,
        getStatus: async () => 0x0b, getBillData: async () => codes.shift(),
        addBill: value => amounts.push(value), requireRecovery: value => recoveries.push(value),
        handlePaymentCompletion: async () => { completed++ }, enableAcceptance: async () => { enabled++; return true },
        setConfig: async () => true,
        setStatusMessage() {}, setTimeout: fn => { fn(); return 1 }, console: { log() {}, warn() {}, error() {} },
      }
      vm.runInNewContext(compiled, context)
      await context.exports.poll()
      const allowed = amount !== null && (backend !== 'bac2400' || amount >= 10000)
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
  for (const [property, building, expected] of [['property3', 'B', 'multi3400'], ['property4', '', 'bac2400'],
    ['property3', 'A', 'oneplus'], ['property1', 'C', 'oneplus'], ['property1', 'D', 'oneplus'], ['property2', '', 'oneplus']]) {
    let handler
    vm.runInNewContext(block, { ipcMain: { handle: (_name, fn) => { handler = fn } },
      hardwareBridge: { isConnected: true }, KIOSK_PROPERTY_ID: property, process: { env: { KIOSK_BUILDING: building } },
      cashBoardInfo: null, ...require('../electron/cash-device-profile'),
    })
    assert.equal((await handler()).cashBackend, expected)
  }
})

for (const stopped of [true, false]) test(`MULTI3400 records every stacked note before completion or stop failure (${stopped})`, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/payment-screen.tsx'), 'utf8')
  const start = source.indexOf('  const pollDeviceStatus = useCallback(')
  const end = source.indexOf('  useEffect(', start)
  const compiled = ts.transpileModule(source.slice(start, end) + '\nexports.poll = pollDeviceStatus', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const notes = [0x32, 0x0a, 0x01, 0x05, 0], amounts = [], completed = [], errors = []
  const context = { exports: {}, useCallback: fn => fn, largeBillsOnly: false, multi3400: true,
    isPollingProcessingRef: { current: false }, paymentCompleteRef: { current: false }, cancellingRef: { current: false },
    latestSession: { current: { acceptedAmount: 0 } }, requiredAmount: 60000,
    getStatus: async () => 0x0b, getBillData: async () => notes.shift(),
    setConfig: async value => { assert.equal(value, 0x1c); return stopped },
    addBill: amount => amounts.push(amount), requireRecovery: error => errors.push(error),
    handlePaymentCompletion: async total => { completed.push(total); assert.deepEqual(amounts, [50000, 10000, 1000, 5000]) },
    enableAcceptance: async () => assert.fail('No reenable after completing'),
    setStatusMessage() {}, setTimeout: fn => { fn(); return 1 }, console: { log() {}, warn() {}, error() {} },
  }
  vm.runInNewContext(compiled, context)
  await context.exports.poll()
  assert.deepEqual(amounts, [50000, 10000, 1000, 5000])
  assert.deepEqual(completed, stopped ? [66000] : [])
  assert.equal(errors.length, stopped ? 0 : 1)
})

test('native BD1 denomination is scoped to B and changes both change and cancellation counts', async () => {
  const { cashPayoutValue } = require('../electron/cash-device-profile')
  assert.equal(cashPayoutValue('property3', 'B', {}), 10000)
  assert.equal(cashPayoutValue('property3', 'B', { MULTI3400_BD1_VALUE: '5000' }), 5000)
  assert.equal(cashPayoutValue('property3', 'B', { MULTI3400_BD1_VALUE: '2000' }), null)
  assert.equal(cashPayoutValue('property4', '', { MULTI3400_BD1_VALUE: '5000' }), 10000)
  const source = fs.readFileSync(path.join(__dirname, '../components/payment-screen.tsx'), 'utf8')
  for (const operation of ['completion', 'cancellation']) {
    const start = source.indexOf(operation === 'completion' ? '  const handlePaymentCompletion = useCallback(' : '  const handleCancel =')
    assert(start >= 0)
    const end = source.indexOf(operation === 'completion' ? '  // Polling Function' : '  const changeCashMethod', start)
    const block = source.slice(start, end) + `\nexports.run = ${operation === 'completion' ? 'handlePaymentCompletion' : 'handleCancel'}`
    const compiled = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    for (const payoutValue of [5000, 10000]) {
      const payouts = [], returns = [], errors = []
      const context = { exports: {}, useCallback: fn => fn, getCashPayoutValue: async () => payoutValue,
        requiredAmount: 60000, recordCashReturned: amount => returns.push(amount), requireRecovery: error => errors.push(error),
        pollingRef: { current: null }, paymentCompleteRef: { current: false }, acceptanceAttemptedRef: { current: true },
        cancellingRef: { current: false }, isPollingProcessingRef: { current: false }, cashInitializationRef: { current: Promise.resolve() },
        latestSession: { current: { acceptedAmount: 15000 } }, setIsProcessing() {}, setIsCancelling() {}, setStatusMessage() {},
        initializeDevice: async () => true, setConfig: async () => true, setEventCallback() {},
        isBillDispenserConnected: () => true, dispenseBills: async count => { payouts.push(count); return true },
        cancelPayment: async () => true, onCancel() {}, completionCallback: { current: async () => {} },
        setTimeout: fn => { fn(); return 1 }, console: { log() {}, warn() {}, error() {} },
      }
      vm.runInNewContext(compiled, context)
      await context.exports.run(75000)
      assert.deepEqual(payouts, payoutValue === 5000 ? [3] : [])
      assert.deepEqual(returns, payoutValue === 5000 ? [15000] : [])
      assert.equal(errors.length, payoutValue === 5000 ? 0 : 1)
    }
  }
})

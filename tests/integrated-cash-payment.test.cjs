const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const profile = require('../electron/cash-device-profile')
const packet = (a, b, c) => [0x24, a, b, c, (a + b + c) & 255]
const source = fs.readFileSync(path.join(__dirname, '../components/payment-screen.tsx'), 'utf8')
function compile(block) {
  return ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
}
async function screenProfile(backend, unit) {
  const fields = {}
  vm.runInNewContext(compile(source.slice(source.indexOf('  useEffect(() => {'), source.indexOf('  // Polling Interval Ref'))), {
    useEffect: fn => fn(), window: { electronAPI: { getHardwareStatus: async () => ({ cashBackend: backend, cashPayoutUnit: unit }) } },
    setLargeBillsOnly: value => { fields.largeBillsOnly = value },
    setIntegratedCash: value => { fields.integratedCash = value },
    setCashPayoutUnit: value => { fields.cashPayoutUnit = value },
  })
  await Promise.resolve()
  return fields
}

// Execute the real payment polling callback with synthetic device replies and journal callbacks.
test('B books every received bill; Camp rejects small notes; unknown codes require recovery', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/payment-screen.tsx'), 'utf8')
  const start = source.indexOf('  const pollDeviceStatus = useCallback(')
  const end = source.indexOf('  useEffect(', start)
  assert(start >= 0 && end > start)
  const compiled = ts.transpileModule(source.slice(start, end) + '\nexports.poll = pollDeviceStatus', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  for (const backend of ['multi3400', 'bac2400', 'oneplus']) {
    const fields = await screenProfile(backend, backend === 'multi3400' ? 5000 : 10000)
    for (const [code, amount] of [[0x01, 1000], [0x05, 5000], [0x0a, 10000], [0x32, 50000], [0xff, null]]) {
      const amounts = [], recoveries = []; let enabled = 0, completed = 0
      const context = { exports: {}, useCallback: fn => fn, ...fields,
        isPollingProcessingRef: { current: false }, paymentCompleteRef: { current: false }, cancellingRef: { current: false },
        latestSession: { current: { acceptedAmount: 0 } }, requiredAmount: 60000,
        getStatus: async () => 0x0b, getBillData: async () => code,
        addBill: value => amounts.push(value), requireRecovery: value => recoveries.push(value),
        handlePaymentCompletion: async () => { completed++ }, enableAcceptance: async () => { enabled++; return true },
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
    const status = await handler()
    assert.equal(status.cashBackend, expected)
    assert.equal(status.cashPayoutUnit, expected === 'multi3400' ? 5000 : 10000)
  }
})

test('payout unit is scoped to B and accepts only configured banknote denominations', () => {
  for (const [property, building] of [['property4', ''], ['property3', 'A'], ['property1', 'C'], ['property1', 'D']]) {
    assert.equal(profile.cashPayoutUnit(property, building, { MULTI3400_BD1_VALUE: '5000' }), 10000)
    assert.equal(profile.usesIntegratedCash(property, building), property === 'property4')
  }
  assert.equal(profile.usesIntegratedCash('property3', 'B'), true)
  for (const unit of [1000, 5000, 10000, 50000]) {
    assert.equal(profile.cashPayoutUnit('property3', 'B', { MULTI3400_BD1_VALUE: String(unit) }), unit)
  }
  for (const value of ['bad', '', '2000', '0']) {
    assert.equal(profile.cashPayoutUnit('property3', 'B', { MULTI3400_BD1_VALUE: value }), 5000)
  }
})

async function payoutUtility(backend, partial = null, acceptanceDelay = 0) {
  const commands = []; let receiver, started = false
  const api = { getHardwareStatus: async () => ({ connected: true }), onBillDispenserStatus() {},
    onBillDispenserData: fn => { receiver = fn },
    sendToBillDispenser: async command => {
      commands.push(Array.from(command))
      let response
      if (command[1] === 0x48) response = packet(0x6D, 0x65, 0x21)
      else if (command[1] === 0x49) response = packet(0x69, 0, 0x61)
      else if (command[1] === 0x44) { started = command[2]; response = packet(0x64, command[2], backend === 'bac2400' ? 0x53 : 0x61) }
      else response = started ? packet(0x73, partial === null ? started : partial, partial === null ? 0x6F : 0x6E) : packet(0x73, 0x74, 0x62)
      if (command[1] === 0x44 && acceptanceDelay) setTimeout(() => receiver({ data: response }), acceptanceDelay)
      else receiver({ data: response })
      return { success: true }
    },
  }
  const exports = {}
  vm.runInNewContext(compile(fs.readFileSync(path.join(__dirname, '../lib/bill-dispenser-utils.ts'), 'utf8')), {
    exports, require: name => { assert.equal(name, '@/lib/hardware-timeout'); return { hardwareCallWithin: fn => fn() } },
    window: { electronAPI: api }, Uint8Array, Date, setTimeout, clearTimeout, console: { log() {} },
  })
  assert.equal(await exports.connectBillDispenser(), true)
  commands.length = 0
  return { ...exports, commands }
}

async function moneyScreen(backend, unit, partial = null, amount = 70000, required = 30000) {
  const fields = await screenProfile(backend, unit)
  const utility = await payoutUtility(backend, partial), returned = [], recoveries = [], completed = [], reports = []
  const context = { exports: {}, ...fields, useCallback: fn => fn,
    latestSession: { current: { acceptedAmount: amount, returnedAmount: 0, reservationData: { roomNumber: 'QA' }, sessionStartTime: 1 } },
    requiredAmount: required, paymentCompleteRef: { current: false }, cancellingRef: { current: false }, pollingRef: { current: null },
    isPollingProcessingRef: { current: false }, cashInitializationRef: { current: null }, acceptanceAttemptedRef: { current: true },
    initializeDevice: async () => true, setConfig: async () => true, setEventCallback() {},
    requireRecovery: message => recoveries.push(message), recordCashReturned: amount => returned.push(amount),
    completionCallback: { current: value => completed.push(value) },
    window: { electronAPI: { reportDeviceFault() {}, paymentRecovery: { reportChangeOwed: async value => reports.push(value) } } },
    hardwareCallWithin: fn => fn(), ...utility,
    cancelPayment: async () => true, onCancel: () => completed.push('cancelled'),
    setIsCancelling() {}, setError() {}, setIsProcessing() {}, setStatusMessage() {}, clearInterval() {},
    setTimeout: fn => { fn(); return 1 }, console: { log() {}, warn() {}, error() {} },
  }
  const block = source.slice(source.indexOf('  const handlePaymentCompletion ='), source.indexOf('  // Polling Function')) +
    source.slice(source.indexOf('  const handleCancel ='), source.indexOf('  const changeCashMethod =')) +
    '\nexports.complete = handlePaymentCompletion; exports.cancel = handleCancel'
  vm.runInNewContext(compile(block), context)
  return { ...context.exports, returned, recoveries, completed, reports, commands: utility.commands }
}

test('B 40000-won change sends $ D 8 S through real ONEPLUS verification; Camp retains its direct four-note path', async () => {
  for (const [backend, unit, count] of [['multi3400', 5000, 8], ['bac2400', 10000, 4], ['oneplus', 10000, 4]]) {
    const h = await moneyScreen(backend, unit)
    await h.complete(70000)
    assert.deepEqual(h.commands.filter(command => command[1] === 0x44), [packet(0x44, count, 0x53)])
    assert.equal(h.commands.some(command => command[1] === 0x49), backend !== 'bac2400')
    assert.deepEqual(h.returned, [40000]); assert.equal(h.completed.length, 1); assert.deepEqual(h.recoveries, [])
  }
})

test('B confirmed three-note partial change books 15000 returned and 25000 still owed', async () => {
  const h = await moneyScreen('multi3400', 5000, 3)
  await h.complete(70000)
  assert.deepEqual(h.returned, [15000])
  assert.equal(h.completed[0].changeOwed, 25000)
  assert.equal(h.reports[0].returnedAmount, 15000)
  assert.equal(h.reports[0].changeOwed, 25000)
  assert.equal(h.commands.filter(command => command[1] === 0x44).length, 1)
})

test('ONEPLUS payout acceptance can take 1500ms through the board and is never sent twice', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const h = await payoutUtility('multi3400', null, 1500)
  let result
  const pending = h.dispenseBillsVerified(8, 'oneplus').then(value => { result = value })
  for (let elapsed = 0; result === undefined && elapsed < 2500; elapsed += 100) {
    await new Promise(resolve => setImmediate(resolve))
    t.mock.timers.tick(100)
  }
  await new Promise(resolve => setImmediate(resolve))
  assert(result, 'verification must finish within this simulated interval')
  await pending
  assert.equal(result.complete, true)
  assert.equal(result.dispensed, 8)
  assert.deepEqual(h.commands.filter(command => command[1] === 0x44), [packet(0x44, 8, 0x53)])
})

test('B and Camp refunds use their payout units; non-divisible cash retains existing recovery behavior', async () => {
  for (const [backend, unit, count] of [['multi3400', 5000, 8], ['bac2400', 10000, 4]]) {
    const h = await moneyScreen(backend, unit, null, 40000)
    await h.cancel()
    assert.deepEqual(h.commands.filter(command => command[1] === 0x44), [packet(0x44, count, 0x53)])
    assert.deepEqual(h.returned, [40000]); assert.deepEqual(h.completed, ['cancelled'])
    const indivisible = await moneyScreen(backend, unit, null, 41000)
    await indivisible.cancel()
    assert.equal(indivisible.recoveries.length, 1); assert.deepEqual(indivisible.commands, [])
  }
})

test('MULTI3400 environment uses the same native loading and child inheritance as KIOSK_BUILDING', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const bootstrap = fs.readFileSync(path.join(__dirname, '../electron/bootstrap.js'), 'utf8')
  assert.match(bootstrap, /Object\.assign\(process\.env, config\.env/)
  assert.match(main, /require\("dotenv"\)\.config/)
  const spawn = main.slice(main.indexOf('hardwareServerProcess = spawn('), main.indexOf('cashTrace.capture(hardwareServerProcess.stdout)'))
  assert.doesNotMatch(spawn, /\benv\s*:/, 'no replacement environment may drop the native local setting')
})

test('moved hardware is reported natively and invalid hardware fails the cash preflight before acceptance', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const block = source.slice(source.indexOf('ipcMain.handle("get-hardware-status"'), source.indexOf('ipcMain.handle("disconnect-printer"')) +
    source.slice(source.indexOf("ipcMain.handle('cash:available'"), source.indexOf('const cashDiagnostics ='))
  for (const [configured, expected, available] of [['beach-b', 'multi3400', true], ['bad', null, false], ['camp', null, false]]) {
    const handlers = new Map()
    vm.runInNewContext(block, { ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      global: {}, KIOSK_PROPERTY_ID: 'property3', process: { env: { KIOSK_BUILDING: 'A', KIOSK_HARDWARE: configured } },
      hardwareBridge: { isConnected: true }, cashBoardInfo: null, ...profile })
    const status = await handlers.get('get-hardware-status')()
    assert.equal(status.cashBackend, expected)
    assert.equal(status.connected, available)
    if (available) assert.equal(status.cashPayoutUnit, 5000)
    assert.equal(handlers.get('cash:available')(), available)
  }
})

test('startup prefers the configured A/B or C/D sales building but keeps unpartitioned and Camp/Kariv locations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const start = source.match(/const KIOSK_START_LOCATION = .*/)[0]
  const url = source.slice(source.indexOf('function getKioskStartUrl('), source.indexOf('async function startNextServer('))
  for (const [property, building, location, expected] of [
    ['property3', 'A', 'B', 'A'], ['property3', 'B', 'A', 'B'],
    ['property1', 'C', 'D', 'C'], ['property1', 'D', 'C', 'D'], ['property1', '', 'C', 'C'],
    ['property4', '', 'CAMP', 'CAMP'], ['property2', 'B', 'KARIV', 'KARIV'],
  ]) {
    const context = { KIOSK_PROPERTY_ID: property, process: { env: { KIOSK_BUILDING: building, KIOSK_START_LOCATION: location } }, encodeURIComponent }
    vm.runInNewContext(start + '\n' + url + '\nresult = getKioskStartUrl("http://localhost:3000/")', context)
    assert.equal(context.result, `http://localhost:3000/kiosk/${expected}`)
  }
})

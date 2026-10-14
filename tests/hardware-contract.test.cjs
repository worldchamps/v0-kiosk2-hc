const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const root = path.join(__dirname, "..")
const packet = (a, b, c) => [0x24, a, b, c, (a + b + c) & 0xff]

// Real renderer utilities, fake IPC only. No Electron app, network, COM or printer is opened.
function load(relative, electronAPI, dependencies = {}, timers = new Set(), runtime = {}) {
  const source = fs.readFileSync(path.join(root, relative), "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const inspect = relative === 'lib/bill-dispenser-utils.ts'
    ? ';exports.readState = () => ({ currentStatus, dispensedCount, lastErrorCode })' : ''
  vm.runInNewContext(code + inspect, {
    exports, Uint8Array, Date,
    require(name) {
      if (name === "@/lib/hardware-timeout") return load("lib/hardware-timeout.ts", electronAPI, {}, timers).api
      assert(name in dependencies, `Unexpected import: ${name}`); return dependencies[name]
    },
    window: { electronAPI },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback, milliseconds) {
      const timer = setTimeout(() => { timers.delete(timer); callback() }, Math.min(milliseconds, 20))
      timers.add(timer)
      return timer
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer) },
    ...runtime,
  })
  return { api: exports, timers }
}

function device(kind, runtime = {}) {
  const suffix = kind === "acceptor" ? "Acceptor" : "Dispenser"
  let onData, onStatus
  let response = () => packet(0x6d, 0x65, 0x13)
  let result = { success: true }, sends = 0
  const traces = [], commands = []
  let hardwareStatus = async () => ({ connected: true })
  let reconnect = async () => ({ success: true })
  const ipc = {
    cashDiagnostics: { trace: value => traces.push(value) },
    getHardwareStatus: () => hardwareStatus(),
    ["onBill" + suffix + "Data"]: callback => { onData = callback },
    ["onBill" + suffix + "Status"]: callback => { onStatus = callback },
    ["reconnectBill" + suffix]: () => reconnect(),
    ["sendToBill" + suffix]: async command => {
      sends += 1
      commands.push(Array.from(command))
      if (result instanceof Error) throw result
      if (result.success) {
        const value = response(command)
        if (value) onData?.({ data: value })
      }
      return result
    },
  }
  const loaded = load(`lib/bill-${kind}-utils.ts`, ipc, {}, new Set(), runtime)
  return {
    ...loaded,
    connect: () => loaded.api["connectBill" + suffix](),
    connected: () => loaded.api["isBill" + suffix + "Connected"](),
    serverStatus: status => onStatus?.(status),
    respond: next => { response = next },
    result: next => { result = next },
    hardwareStatus: next => { hardwareStatus = next },
    reconnect: next => { reconnect = next },
    sends: () => sends,
    deliver: data => onData?.({ data }),
    traces, commands,
  }
}

for (const kind of ["acceptor", "dispenser"]) {
  test(`${kind}: an open bridge is not proof of a device connection`, async () => {
    const h = device(kind)
    assert.equal(h.connected(), false)
    assert.equal(await h.connect(), true)
    h.serverStatus({ connected: false })
    h.serverStatus({ connected: true })
    assert.equal(h.connected(), false)
    assert.equal(await h.api.checkConnection(), true)
    assert.equal(h.connected(), true)
    h.serverStatus({ connected: false })
    assert.equal(h.connected(), false)
  })

  test(`${kind}: IPC false and rejection return failure and clear pending timers`, async () => {
    const h = device(kind)
    await h.connect()
    for (const result of [{ success: false }, new Error("offline")]) {
      h.result(result)
      assert.equal(await h.api.checkConnection(), false)
      assert.equal(h.timers.size, 0)
    }
  })

  test(`${kind}: malformed responses time out and concurrent commands cannot overwrite waiters`, async () => {
    const h = device(kind)
    await h.connect()
    h.respond(() => [0x24, 0x6d, 0x65, 0x13, 0])
    const before = h.sends()
    const first = h.api.checkConnection()
    assert.equal(await h.api.checkConnection(), false)
    assert.equal(h.sends(), before + 1)
    assert.equal(await first, false)
    assert.equal(h.timers.size, 0)
  })

  test(`${kind}: a hung IPC invocation is bounded by the same command timer`, async () => {
    const h = device(kind)
    await h.connect()
    h.result(new Promise(() => {}))
    assert.equal(await h.api.checkConnection(), false)
    assert.equal(h.timers.size, 0)
  })

  test(`${kind}: a hung status query cannot leave connection UI waiting forever`, { timeout: 1000 }, async () => {
    const h = device(kind)
    h.hardwareStatus(() => new Promise(() => {}))
    assert.equal(await h.connect(), false)
    assert.equal(h.connected(), false)
    assert.equal(h.timers.size, 0)
  })

  test(`${kind}: a hung reconnect request also ends the connection attempt`, { timeout: 3000 }, async () => {
    const h = device(kind)
    h.hardwareStatus(async () => ({ connected: false }))
    h.reconnect(() => new Promise(() => {}))
    assert.equal(await h.connect(), false)
    assert.equal(h.connected(), false)
    assert.equal(h.timers.size, 0)
  })
}

test("acceptor: NG cannot confirm the payment STOP command", async () => {
  const h = device("acceptor")
  await h.connect()
  h.respond(() => packet(0x4e, 0x47, 0))
  assert.equal(await h.api.setConfig(0x1c), false)
  h.respond(() => packet(0x4f, 0x4b, 0))
  assert.equal(await h.api.setConfig(0x1c), true)
})

test('acceptor records NG, timeout and transport failure outcomes', async () => {
  const h = device('acceptor')
  await h.connect()
  h.respond(() => packet(0x4e, 0x47, 0))
  assert.equal(await h.api.initializeDevice(), false)
  assert.equal(h.traces.at(-1).result, 'ng')
  h.respond(() => null)
  assert.equal(await h.api.setConfig(0x1c), false)
  assert.equal(h.traces.at(-1).result, 'timeout')
  h.result({ success: false })
  assert.equal(await h.api.setConfig(0x1c), false)
  assert.equal(h.traces.at(-1).result, 'send_failed')
  assert.equal(h.timers.size, 0)
})

test('cash shutdown waits for reset settling and a fresh ready status before STOP', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = device('acceptor', { setTimeout, clearTimeout, Date })
  await h.connect()
  const commands = []
  let readyAt, finished = false, result
  h.respond(command => {
    commands.push({ bytes: command, at: Date.now() })
    if (command[1] === 0x52) { readyAt = Date.now() + 3000; return packet(0x4f, 0x4b, 0x61) }
    // D211: reset ACK is immediate but the device ignores the next STOP while restarting.
    if (Date.now() < readyAt) return null
    if (command[1] === 0x47) return packet(0x67, 0x61, 0x01)
    return packet(0x4f, 0x4b, 0x63)
  })
  const shutdown = (async () => {
    result = await h.api.initializeDevice() && await h.api.setConfig(0x1c)
    finished = true
  })()
  const settle = () => new Promise(resolve => setImmediate(resolve))
  await settle()
  assert.deepEqual(commands.map(c => c.bytes[1]), [0x52], 'RST ACK alone must not permit STOP')
  t.mock.timers.tick(3499); await settle()
  assert.equal(finished, false)
  assert.equal(commands.length, 1)
  t.mock.timers.tick(1); await settle(); await shutdown
  assert.equal(result, true)
  assert.deepEqual(commands.map(c => c.bytes[1]), [0x52, 0x47, 0x53])
  assert(commands[2].at - commands[0].at >= 3500)
})

for (const [label, response, expected] of [
  ['ready to accept', packet(0x67, 0x61, 0x02), true],
  ['device error', packet(0x67, 0x61, 0x0c), false],
  ['still stacking', packet(0x67, 0x61, 0x0b), false],
  ['missing status response', null, false],
]) {
  test(`reset readiness is bounded and requires a known idle state: ${label}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const h = device('acceptor', { setTimeout, clearTimeout, Date })
    await h.connect()
    let resets = 0, polls = 0, done = false, actual
    h.respond(command => {
      if (command[1] === 0x52) { resets++; return packet(0x4f, 0x4b, 0x61) }
      assert.equal(command[1], 0x47, 'readiness may only query status, never enable or return cash')
      polls++; return response
    })
    const pending = h.api.initializeDevice().then(value => { actual = value; done = true })
    await new Promise(resolve => setImmediate(resolve))
    for (let elapsed = 0; !done && elapsed < 15000; elapsed += 500) {
      t.mock.timers.tick(500)
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(done, true, 'reset readiness must not wait forever')
    await pending
    assert.equal(actual, expected)
    assert.equal(resets, 1, 'do not repeat reset')
    assert(polls >= 1 && polls <= 3)
  })
}

test('reset can become ready on a later status query without a second reset', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = device('acceptor', { setTimeout, clearTimeout, Date })
  await h.connect()
  let resets = 0, polls = 0, ready = false
  h.respond(command => {
    if (command[1] === 0x52) { resets++; return packet(0x4f, 0x4b, 0x61) }
    polls++; return packet(0x67, 0x61, polls === 1 ? 0x04 : 0x01)
  })
  const pending = h.api.initializeDevice().then(value => { ready = value })
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(3500); await new Promise(resolve => setImmediate(resolve))
  assert.equal(ready, false); assert.equal(polls, 1)
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve)); await pending
  assert.equal(ready, true); assert.equal(polls, 2); assert.equal(resets, 1)
})

for (const [label, acknowledgement, statuses, expected] of [
  ['start, moving, complete', packet(0x64, 4, 0x61), [packet(0x73, 0x6f, 0x6e), packet(0x73, 4, 0x6f)], { dispensed: 4, complete: true }],
  ['partial abnormal end', packet(0x64, 4, 0x61), [packet(0x73, 2, 0x6e)], { dispensed: 2, complete: false }],
  ['partial normal end', packet(0x64, 4, 0x61), [packet(0x73, 2, 0x6f)], { dispensed: 2, complete: false }],
  ['all notes out, then empty detected', packet(0x64, 4, 0x61), [packet(0x73, 4, 0x6e)], { dispensed: 4, complete: true }],
  ['cannot dispense', packet(0x6e, 0x73, 0x21), [], { dispensed: 0, complete: false }],
  ['missing start reply', null, [], { dispensed: null, complete: false }],
  ['unreadable start reply', packet(0x64, 4, 0x53), [], { dispensed: null, complete: false }],
  ['mismatched start count', packet(0x64, 3, 0x61), [], { dispensed: null, complete: false }],
  ['missing status reply', packet(0x64, 4, 0x61), [null], { dispensed: null, complete: false }],
  ['unreadable status', packet(0x64, 4, 0x61), [packet(0x73, 0x74, 0x62)], { dispensed: null, complete: false }],
  ['count above request', packet(0x64, 4, 0x61), [packet(0x73, 5, 0x6f)], { dispensed: null, complete: false }],
]) {
  test(`verified ONEPLUS payout: ${label}; one payout command only`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const h = device('dispenser', { setTimeout, clearTimeout, Date }); await h.connect()
    const sent = [], replies = [...statuses]
    let started = false
    h.respond(command => {
      sent.push({ command, at: Date.now() })
      if (command[1] === 0x49) return packet(0x69, 0, 0x61)
      if (command[1] === 0x44) { started = true; return acknowledgement }
      return started ? replies.shift() : packet(0x73, 0x74, 0x62)
    })
    let done = false, actual
    const pending = h.api.dispenseBillsVerified(4).then(result => { done = true; actual = result })
    for (let elapsed = 0; !done && elapsed < 15000; elapsed += 100) {
      await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(100)
    }
    await new Promise(resolve => setImmediate(resolve)); assert(done); await pending
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected)
    assert.deepEqual(sent.slice(0, 3).map(x => Array.from(x.command)), [packet(0x49, 0, 0), packet(0x53, 0, 0), packet(0x44, 4, 0x53)])
    assert.equal(sent.filter(x => x.command[1] === 0x49).length, 1)
    assert.equal(sent.filter(x => x.command[1] === 0x44).length, 1)
    for (const query of sent.filter(x => x.command[1] === 0x53)) assert.deepEqual(Array.from(query.command), packet(0x53, 0, 0))
    if (statuses.length === 2) assert.equal(sent[4].at - sent[3].at, 300)
    assert.equal(h.timers.size, 0)
    // Both start/rejection waiters must be removed before the next transaction.
    h.respond(() => packet(0x6e, 0x73, 0x21))
    assert.equal((await h.api.dispenseBillsVerified(4)).dispensed, 0)
  })
}
for (const [label, initialized, statuses, expected] of [
  ['initializing then idle', packet(0x69, 0, 0x61), [packet(0x73, 0x6f, 0x6e), packet(0x73, 0x74, 0x62)], { dispensed: 4, complete: true }],
  ['previous normal end', packet(0x69, 0, 0x61), [packet(0x73, 2, 0x6f)], { dispensed: 4, complete: true }],
  ['reset refused', packet(0x6e, 0x73, 0x21), [], { dispensed: 0, complete: false }],
  ['reset timeout', null, [], { dispensed: 0, complete: false }],
  ['unreadable reset reply', packet(0x69, 0, 0x53), [], { dispensed: 0, complete: false }],
  ['wrong reset acknowledgement', packet(0x69, 1, 0x61), [], { dispensed: 0, complete: false }],
  ['bad reset checksum', [0x24, 0x69, 0, 0x61, 0], [], { dispensed: 0, complete: false }],
  ['still moving', packet(0x69, 0, 0x61), [packet(0x73, 0x6f, 0x6e)], { dispensed: 0, complete: false }],
  ['error stop', packet(0x69, 0, 0x61), [packet(0x73, 0, 0x6e)], { dispensed: 0, complete: false }],
  ['inhibited', packet(0x69, 0, 0x61), [packet(0x73, 0x68, 0x21)], { dispensed: 0, complete: false }],
  ['missing ready reply', packet(0x69, 0, 0x61), [null], { dispensed: 0, complete: false }],
]) {
  test(`ONEPLUS resets once and verifies readiness before any payout: ${label}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const h = device('dispenser', { setTimeout, clearTimeout, Date }); await h.connect()
    const sent = [], readiness = [...statuses]
    let started = false
    h.respond(command => {
      sent.push({ command, at: Date.now() })
      if (command[1] === 0x49) return initialized
      if (command[1] === 0x44) { started = true; return packet(0x64, 4, 0x61) }
      return started ? packet(0x73, 4, 0x6f) : readiness.length > 1 ? readiness.shift() : readiness[0]
    })
    let done = false, actual
    const pending = h.api.dispenseBillsVerified(4, 'oneplus').then(value => { actual = value; done = true })
    await new Promise(resolve => setImmediate(resolve))
    for (let elapsed = 0; !done && elapsed < 7000; elapsed += 100) {
      t.mock.timers.tick(100); await new Promise(resolve => setImmediate(resolve))
    }
    await new Promise(resolve => setImmediate(resolve)); assert(done); await pending
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected)
    assert.equal(sent.filter(x => x.command[1] === 0x49).length, 1)
    assert.equal(sent.filter(x => x.command[1] === 0x44).length, expected.complete ? 1 : 0)
    assert.deepEqual(Array.from(sent[0].command), packet(0x49, 0, 0))
    if (!statuses.length) {
      assert.equal(sent.length, 1, 'an unconfirmed reset must not query status or dispense')
      if (initialized === null || label === 'bad reset checksum') assert.equal(Date.now(), 1500)
    } else if (!expected.complete) assert.equal(Date.now(), 5000)
    if (label === 'initializing then idle') assert.equal(sent[2].at - sent[1].at, 300)
    assert.equal(h.timers.size, 0)
  })
}
for (const count of [4, 250]) {
  test(`verified ONEPLUS ${count} notes bounds moving status by total deadline without retry`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const h = device('dispenser', { setTimeout, clearTimeout, Date }); await h.connect()
    let started = false
    h.respond(command => {
      if (command[1] === 0x49) return packet(0x69, 0, 0x61)
      if (command[1] === 0x44) { started = true; return packet(0x64, count, 0x61) }
      return started ? packet(0x73, 0x6f, 0x6e) : packet(0x73, 0x74, 0x62)
    })
    let done = false, actual
    h.api.dispenseBillsVerified(count).then(result => { done = true; actual = result })
    const limit = Math.min(count * 1500 + 5000, 40000)
    for (let elapsed = 0; !done && elapsed <= limit; elapsed += 100) {
      await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(100)
    }
    await new Promise(resolve => setImmediate(resolve)); assert(done)
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), { dispensed: null, complete: false })
    assert(Date.now() >= limit && Date.now() <= limit + 100)
    assert.equal(h.commands.filter(command => command[1] === 0x44).length, 1)
  })
}
test('verified bac2400 keeps the adapter completion meaning and never adds ONEPLUS status polls', async () => {
  const h = device('dispenser'); await h.connect()
  for (const success of [true, false]) {
    h.respond(command => success ? packet(0x64, command[2], 0x53) : null)
    const before = h.commands.length
    const actual = await h.api.dispenseBillsVerified(4, 'bac2400')
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), { dispensed: success ? 4 : null, complete: success })
    assert.deepEqual(h.commands.slice(before), [packet(0x44, 4, 0x53)])
  }
})

test("dispenser: integer count and the existing response command/count must match", async () => {
  const h = device("dispenser")
  await h.connect()
  const before = h.sends()
  for (const count of [NaN, 1.5, 0, 251]) assert.equal(await h.api.dispenseBills(count), false)
  assert.equal(h.sends(), before)
  h.respond(command => packet(0x64, command[2] + 1, 0x53))
  assert.equal(await h.api.dispenseBills(2), false)
  h.respond(command => packet(0x64, command[2], 0x53))
  assert.equal(await h.api.dispenseBills(2), true)
})

for (const cmd1 of [0x73, 0x53]) {
  for (const [label, cmd2, data, result, state, count] of [
    ['idle', 0x74, 0x62, 0x62, 0, 0],
    ['dispensing', 0x6f, 0x6e, 0x6f, 1, 0],
    ['inhibited', 0x68, 0x21, 0x21, 2, 0],
    ['normal end', 2, 0x6f, 0x62, 3, 2],
    ['normal end with ASCII o count', 0x6f, 0x6f, 0x62, 3, 0x6f],
    ['abnormal end', 2, 0x6e, 0x65, 4, 2],
  ]) {
    test(`dispenser status ${cmd1.toString(16)}: ${label} follows the ONEPLUS numeric contract`, async () => {
      const h = device('dispenser')
      await h.connect()
      h.respond(() => packet(cmd1, cmd2, data))
      assert.equal(await h.api.getDispenserStatus(), result)
      assert.deepEqual(h.commands.at(-1), [0x24, 0x53, 0, 0, 0x53])
      assert.equal(h.api.readState().currentStatus, state)
      assert.equal(h.api.readState().dispensedCount, count)
      assert.equal(h.timers.size, 0)
    })
  }
}

test('dispenser error replies preserve each spec error code without claiming readiness or a count', async () => {
  const h = device('dispenser')
  await h.connect()
  for (const code of [0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x8a, 0x8c, 0x8e]) {
    h.respond(() => packet(0x73, 0x65, code))
    assert.equal(await h.api.getDispenserStatus(), 0x65)
    assert.equal(h.api.readState().lastErrorCode, code)
    assert.equal(h.api.readState().currentStatus, 4)
    assert.equal(h.api.readState().dispensedCount, 0)
  }
  assert.equal(h.timers.size, 0)
})

test('dispenser status accepts a fragmented reply after another frame without consuming a connection waiter', async () => {
  const h = device('dispenser')
  await h.connect()
  h.respond(() => null)
  const status = h.api.getDispenserStatus(), connection = h.api.checkConnection()
  const ready = packet(0x53, 3, 0x6f)
  h.deliver([...packet(0x69, 0, 0x61), ...ready.slice(0, 2)])
  h.deliver(ready.slice(2))
  assert.equal(await status, 0x62)
  assert.equal(h.api.readState().dispensedCount, 3)
  assert.equal(h.timers.size, 1, 'the connection command still needs its own reply')
  h.deliver(packet(0x6d, 0x65, 0x21))
  assert.equal(await connection, true)
  assert.equal(h.timers.size, 0)
})

test('dispenser status ignores bad checksums and other commands, deduplicates waiters and can retry after timeout', async () => {
  const h = device('dispenser')
  await h.connect()
  h.respond(() => null)
  const before = h.sends(), first = h.api.getDispenserStatus()
  assert.equal(await h.api.getDispenserStatus(), -1)
  assert.equal(h.sends(), before + 1)
  const bad = packet(0x73, 0x74, 0x62); bad[4] ^= 1
  h.deliver([...packet(0x64, 1, 0x61), ...bad])
  assert.equal(await first, -1)
  assert.equal(h.timers.size, 0)
  h.respond(() => packet(0x73, 0x74, 0x62))
  assert.equal(await h.api.getDispenserStatus(), 0x62)
  assert.equal(h.timers.size, 0)
})

test("missing Electron fails closed without accessing a browser device API", async () => {
  assert.equal(await load("lib/bill-acceptor-utils.ts").api.connectBillAcceptor(), false)
  assert.equal(await load("lib/bill-dispenser-utils.ts").api.connectBillDispenser(), false)
})

function printer(ipc, property = "property3") {
  return load("lib/printer-utils.ts", ipc, {
    "@/electron/sam4s-receipt": { buildSam4sReceiptHtml() { throw new Error("Unexpected property4 print") } },
    "@/lib/property-utils": { getKioskPropertyId: () => property },
  }).api
}

test('receipt without change owed remains byte-identical to 1.3.43; unpaid change adds one line', async () => {
  const crypto = require('node:crypto'), receipts = require('../electron/sam4s-receipt')
  const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
  const data = { hotelName: 'THE BEACH STAY', roomNumber: 'D212', password: '1234', checkInDate: '2026-10-14', checkOutDate: '2026-10-15' }
  const note = '미지급 거스름돈 20,000원 · 문의 010-5126-4644'
  const html = receipts.buildSam4sReceiptHtml(data), lines = receipts.buildSam4sPrintLines(data)
  // Baselines captured from HEAD 6428347 with the same input, before this change.
  assert.equal(hash(html), '19afc8f240c20890262ff10844d513cd9e9486fffcc2303d6743baf4ec6807e7')
  assert.equal(hash(lines), '3fc4900a8e20f6b0fc0873582cfbb27b0e52a2e485a8cce39579cb9b6b912c8f')
  const owedHtml = receipts.buildSam4sReceiptHtml({ ...data, changeOwed: 20000 })
  assert.equal(owedHtml.replace(`<p class="guide">${note}</p>`, ''), html)
  const owedLines = receipts.buildSam4sPrintLines({ ...data, changeOwed: 20000 })
  assert.equal(owedLines.filter(line => line.text === note).length, 1)
  assert.deepEqual(owedLines.filter(line => line.text !== note), lines)
  const print = async input => {
    const output = [], p = printer({ getHardwareStatus: async () => ({ connected: true }),
      sendRawToBixolon: async value => { output.push(['raw', value]); return true },
      printToBixolon: async (...args) => { output.push(['text', ...args]); return true },
      cutBixolonPaper: async () => { output.push(['cut']); return true },
    }, 'property1')
    assert.equal(await p.printReceipt(input), true)
    return output
  }
  const original = await print(data), owed = await print({ ...data, changeOwed: 20000 })
  assert.equal(hash(original), 'f32eaec8e4626209a4103d80eaf16c2f4acef5f8ede2ca7cd65a8e4712783848')
  assert.equal(owed.filter(command => command[1] === note + '\n').length, 1)
  assert.equal(hash(owed.filter(command => command[1] !== note + '\n')), hash(original))
})
test('SAM4S and WOOSIM IPC receive change owed; unified receipt mapping adds no fields when absent', async () => {
  for (const [property, backend] of [['property4', 'sam4s'], ['property3', 'woosim']]) {
    const received = []
    const p = printer({ getReceiptPrinterStatus: async () => ({ backend, connected: true }),
      [backend === 'sam4s' ? 'printToSam4s' : 'printToWoosim']: async data => { received.push(data); return { success: true } },
    }, property)
    const mapped = [], unified = load('lib/printer-utils-unified.ts', {}, {
      './property-utils': { getKioskPropertyId: () => property, propertyUsesPrinter: () => true },
      '@/lib/printer-utils': { printReceipt: async data => { mapped.push(data); return p.printReceipt(data) } },
    }, new Set(), { process: { env: {} } }).api
    for (const changeOwed of [undefined, 20000]) {
      assert.equal(await unified.printReceipt({ roomNumber: 'B212', password: '1234', ...(changeOwed ? { changeOwed } : {}) }), true)
      assert.equal(Object.hasOwn(mapped.at(-1), 'changeOwed'), changeOwed !== undefined)
      assert.equal(Object.hasOwn(received.at(-1), 'changeOwed'), changeOwed !== undefined)
      assert.equal(received.at(-1).changeOwed, changeOwed)
    }
  }
})

test('QA preview models ONEPLUS reset success/refusal and start then status, preserving existing modes', {
  skip: !fs.existsSync(path.join(root, '.local/payment-flow-preview.cjs')),
}, async () => {
  const source = fs.readFileSync(path.join(root, '.local/payment-flow-preview.cjs'), 'utf8')
  const install = source.slice(source.indexOf('function installMock('), source.indexOf('const runtime ='))
  for (const mode of ['', 'after-payout', 'empty-after-2', 'reset-fails']) {
    const session = new Map([['qa-dispenser', mode]]), replies = []
    const context = { window: { location: { href: 'http://127.0.0.1:3219', origin: 'http://127.0.0.1:3219' }, fetch: async () => {} },
      localStorage: { getItem: () => null }, sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) },
      URL, Date, setTimeout: callback => { queueMicrotask(callback); return 1 }, Promise }
    vm.runInNewContext(install + '\ninstallMock("synthetic")', context)
    const api = context.window.electronAPI
    api.onBillDispenserData(value => replies.push(Array.from(value.data)))
    await api.sendToBillDispenser(packet(0x53, 0, 0))
    assert.deepEqual(replies.at(-1), mode === 'after-payout' ? packet(0x73, 2, 0x6f) : packet(0x73, 0x74, 0x62))
    await api.sendToBillDispenser(packet(0x49, 0, 0))
    assert.deepEqual(replies.at(-1), mode === 'reset-fails' ? packet(0x6e, 0x73, 0x21) : packet(0x69, 0, 0x61))
    if (mode === 'reset-fails') continue
    await api.sendToBillDispenser(packet(0x44, 4, 0x53)); assert.deepEqual(replies.at(-1), packet(0x64, 4, 0x61))
    await api.sendToBillDispenser(packet(0x53, 0, 0))
    assert.deepEqual(replies.at(-1), mode === 'empty-after-2' ? packet(0x73, 2, 0x6e) : packet(0x73, 4, 0x6f))
  }
})

test("C room receipts omit every password instruction while D and A keep their existing receipt", async () => {
  for (const [property, roomNumber, hidden] of [['property1', 'C103', true], ['property1', ' c-105 ', true], ['property1', 'D212', false], ['property3', 'A101', false]]) {
    const output = [], input = { hotelName: 'QA', roomNumber, password: 'test-secret-2468' }
    const p = printer({ getHardwareStatus: async () => ({ connected: true }), sendRawToBixolon: async () => true,
      printToBixolon: async text => { output.push(text); return true }, cutBixolonPaper: async () => true }, property)
    assert.equal(await p.printReceipt(input), true)
    assert.equal(output.join('').includes('test-secret-2468'), !hidden)
    assert.equal(output.join('').includes('비밀번호'), !hidden)
    assert.equal(output.join('').includes('카드키'), hidden)
    assert.equal(input.password, 'test-secret-2468')
  }
})

test("printer: missing IPC or failed transport does not report a printed receipt", async () => {
  assert.equal(await printer(undefined).autoConnectPrinter(), false)
  await assert.rejects(printer(undefined).printText("QA"), /키오스크 앱/)
  let cutCalls = 0
  const p = printer({
    getHardwareStatus: async () => ({ connected: false }),
    sendRawToBixolon: async () => false,
    printToBixolon: async () => false,
    cutBixolonPaper: async () => { cutCalls++; return false },
  })
  assert.equal(await p.autoConnectPrinter(), false)
  assert.equal(p.isPrinterConnected(), false)
  await assert.rejects(p.printText("QA"), /전송하지 못했습니다/)
  assert.equal(await p.printReceipt({ hotelName: "QA", roomNumber: "B901" }), false)
  assert.match(p.getLastPrinterError(), /연결/)
  assert.equal(cutCalls, 0)
})

test("property3 B uses the installed Woosim driver and does not send Bixolon commands", async () => {
  let sent = 0
  const p = printer({
    getReceiptPrinterStatus: async () => ({ backend: "woosim", connected: true }),
    printToWoosim: async () => { sent++; return { success: true } },
    sendRawToBixolon: async () => { throw new Error("Bixolon must not be called") },
  })
  assert.equal(await p.autoConnectPrinter(), true)
  assert.equal(await p.printReceipt({ hotelName: "THE BEACH STAY", roomNumber: "B101" }), true)
  assert.equal(sent, 1)
  const unavailable = printer({
    getReceiptPrinterStatus: async () => null,
    sendRawToBixolon: async () => { throw new Error("Unknown backend must fail closed") },
  })
  assert.equal(await unavailable.printReceipt({ hotelName: "THE BEACH STAY", roomNumber: "B101" }), false)
})

test('Woosim print failures keep the exact error and a later retry refreshes the Windows printer connection', async () => {
  let ready = false, fail = false, jobs = 0; const reports = []
  const p = printer({
    getReceiptPrinterStatus: async () => ({ backend: 'woosim', connected: ready, error: ready ? '' : 'WSP-CP383 드라이버 없음' }),
    printToWoosim: async () => { jobs++; return fail ? { success: false, error: 'Windows spooler failure' } : { success: true } },
    reportPrinterResult: async value => reports.push(value),
  })
  const receipt = { hotelName: 'QA', roomNumber: 'B101' }
  assert.equal(await p.printReceipt(receipt), false); assert.equal(jobs, 0)
  assert.match(p.getLastPrinterError(), /드라이버/)
  ready = true; fail = true
  assert.equal(await p.printReceipt(receipt), false); assert.equal(jobs, 1)
  assert.equal(reports.at(-1).error, 'Windows spooler failure')
  fail = false
  assert.equal(await p.printReceipt(receipt), true); assert.equal(jobs, 2)
  assert.equal(p.getLastPrinterError(), ''); assert.equal(reports.at(-1).status, 'sent')
})

test("Woosim IPC rejects another building before reaching the Windows printer", async () => {
  const source = fs.readFileSync(path.join(root, "electron/main.js"), "utf8")
  const block = source.slice(source.indexOf("const usesWoosim ="), source.indexOf('ipcMain.handle("print-to-sam4s"'))
  const handlers = new Map()
  vm.runInNewContext(block, {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    KIOSK_PROPERTY_ID: "property3", process: { env: { KIOSK_BUILDING: "B" } },
    Buffer, console, buildSam4sPrintLines: () => { throw new Error("Wrong building reached printer") },
  })
  const result = await handlers.get("print-to-woosim")({}, { roomNumber: "A101" })
  assert.equal(result.success, false)
  assert.match(result.error, /B동/)
})

test('Windows printer faults expose short PMS codes instead of printer names or process errors', async () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  for (const [property, backend, roomNumber] of [['property3', 'woosim', 'B101'], ['property4', 'sam4s', 'Camp101']]) {
    const handlers = new Map(), faults = []
    let installed = false, statusBroken = false, printBroken = false
    const driver = backend === 'woosim' ? 'WOOSIM WSP-CP383' : 'SAM4S GCUBE'
    const frame = { url: 'http://localhost:3000' }
    const event = { senderFrame: frame, sender: { mainFrame: frame, getPrintersAsync: async () => {
      if (statusBroken) throw Error('C:\\Windows\\internal printer path')
      return [{ name: installed ? driver : 'Microsoft XPS Document Writer' }]
    } } }
    const context = { ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      KIOSK_PROPERTY_ID: property, process: { env: { KIOSK_BUILDING: 'B' } }, Buffer, Date, URL,
      console: { log() {}, error() {} }, lastPrinterResult: null,
      deviceRecovery: { fault: (key, reason) => faults.push([key, reason]) },
      ...require('../electron/sam4s-receipt'),
      printSam4sWithWindows: async (_name, _lines, route = 'sam4s') => {
        assert.equal(route, backend)
        if (printBroken) throw Error('Internal spooler details'); return 'OK'
      },
    }
    vm.runInNewContext(source.slice(source.indexOf('const usesWoosim ='), source.indexOf('ipcMain.handle("reconnect-printer"')) +
      source.slice(source.indexOf("ipcMain.handle('printer:report-result'"), source.indexOf("ipcMain.on('device-recovery:fault'")), context)
    const status = await handlers.get('receipt-printer-status')(event)
    assert.equal(status.backend, backend); assert.equal(status.connected, false); assert.equal(status.error, 'printer_not_installed')
    const result = await handlers.get(`print-to-${backend}`)(event, { roomNumber })
    assert.equal(result.error, 'printer_not_installed'); assert(!JSON.stringify(result).includes('Microsoft'))
    handlers.get('printer:report-result')(event, { status: 'failed', error: result.error, roomNumber })
    assert.equal(context.lastPrinterResult.roomNumber, roomNumber)
    assert.equal(context.lastPrinterResult.error, 'printer_not_installed')
    assert.deepEqual(faults.at(-1), ['printer', 'printer_not_installed'])
    installed = true; printBroken = true
    assert.equal((await handlers.get(`print-to-${backend}`)(event, { roomNumber })).error, 'printer_failed')
    assert.equal(context.lastPrinterResult.error, 'printer_failed')
    statusBroken = true
    assert.equal((await handlers.get('receipt-printer-status')(event)).error, 'printer_unavailable')
    assert.equal(context.lastPrinterResult.error, 'printer_unavailable')
    statusBroken = false; printBroken = false
    assert.equal((await handlers.get(`print-to-${backend}`)(event, { roomNumber })).success, true)
  }
})

test("printer: a hung transport status query fails closed", { timeout: 1000 }, async () => {
  const p = printer({ getHardwareStatus: () => new Promise(() => {}) })
  assert.equal(await p.autoConnectPrinter(), false)
  assert.equal(p.isPrinterConnected(), false)
})

test("printer IPC forwards the actual transport result, not unconditional success", async () => {
  const source = fs.readFileSync(path.join(root, "electron/main.js"), "utf8")
  const block = source.slice(source.indexOf('ipcMain.handle("send-to-printer"'), source.indexOf("function printSam4sWithWindows"))
  const handlers = new Map()
  let sent = false
  vm.runInNewContext(block, {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    hardwareBridge: { send: () => sent }, Buffer,
  })
  for (const success of [false, true]) {
    sent = success
    assert.equal((await handlers.get("send-to-printer")({}, [1])).success, success)
    assert.equal(await handlers.get("print-to-bixolon")({}, "QA", {}), success)
    assert.equal(await handlers.get("cut-bixolon-paper")({}), success)
    assert.equal(await handlers.get("send-raw-to-bixolon")({}, [1]), success)
  }
})

test("property4 room-info wrapper preserves a rejected Windows print result", async () => {
  const p = load("lib/printer-utils.ts", {
    printToSam4s: async () => ({ success: false, error: "offline" }),
  }, {
    "@/electron/sam4s-receipt": { buildSam4sReceiptHtml() { throw new Error("Unexpected browser print") } },
    "@/lib/property-utils": { getKioskPropertyId: () => "property4" },
  }).api
  assert.equal(await p.printRoomInfoReceipt({ roomNumber: "Camp101", password: "TEST", floor: "1" }), false)
})

test("property4 connection status requires a registered GCUBE printer", async () => {
  const p = load("lib/printer-utils.ts", {
    getReceiptPrinterStatus: async () => ({ backend: "sam4s", connected: false }),
  }, {
    "@/electron/sam4s-receipt": { buildSam4sReceiptHtml() { return "" } },
    "@/lib/property-utils": { getKioskPropertyId: () => "property4" },
  }).api
  assert.equal(await p.autoConnectPrinter(), false)
  assert.equal(p.isPrinterConnected(), false)
})

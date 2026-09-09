const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const root = path.join(__dirname, "..")
const packet = (a, b, c) => [0x24, a, b, c, (a + b + c) & 0xff]

// Real renderer utilities, fake IPC only. No Electron app, network, COM or printer is opened.
function load(relative, electronAPI, dependencies = {}, timers = new Set()) {
  const source = fs.readFileSync(path.join(root, relative), "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, {
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
  })
  return { api: exports, timers }
}

function device(kind) {
  const suffix = kind === "acceptor" ? "Acceptor" : "Dispenser"
  let onData, onStatus
  let response = () => packet(0x6d, 0x65, 0x13)
  let result = { success: true }, sends = 0
  let hardwareStatus = async () => ({ connected: true })
  let reconnect = async () => ({ success: true })
  const ipc = {
    getHardwareStatus: () => hardwareStatus(),
    ["onBill" + suffix + "Data"]: callback => { onData = callback },
    ["onBill" + suffix + "Status"]: callback => { onStatus = callback },
    ["reconnectBill" + suffix]: () => reconnect(),
    ["sendToBill" + suffix]: async command => {
      sends += 1
      if (result instanceof Error) throw result
      if (result.success) {
        const value = response(command)
        if (value) onData?.({ data: value })
      }
      return result
    },
  }
  const loaded = load(`lib/bill-${kind}-utils.ts`, ipc)
  return {
    ...loaded,
    connect: () => loaded.api["connectBill" + suffix](),
    disconnect: () => loaded.api["disconnectBill" + suffix](),
    connected: () => loaded.api["isBill" + suffix + "Connected"](),
    serverStatus: status => onStatus?.(status),
    respond: next => { response = next },
    result: next => { result = next },
    hardwareStatus: next => { hardwareStatus = next },
    reconnect: next => { reconnect = next },
    sends: () => sends,
  }
}

for (const kind of ["acceptor", "dispenser"]) {
  test(`${kind}: an open bridge is not proof of a device connection`, async () => {
    const h = device(kind)
    assert.equal(h.connected(), false)
    assert.equal(await h.connect(), true)
    await h.disconnect()
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

test("acceptor: NG cannot confirm disable and unknown configuration is not fabricated", async () => {
  const h = device("acceptor")
  await h.connect()
  assert.equal(await h.api.getConfig(), null)
  assert.equal(await h.api.getErrorCode(), null)
  h.respond(() => packet(0x4e, 0x47, 0))
  assert.equal(await h.api.disableAcceptance(), false)
  h.respond(() => packet(0x4f, 0x4b, 0))
  assert.equal(await h.api.disableAcceptance(), true)
  assert.equal(await h.api.setConfig(0x3c), true)
  assert.equal(await h.api.getConfig(), 0x3c)
  h.serverStatus({ connected: false })
  assert.equal(await h.api.getConfig(), null)
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
  assert.equal(h.api.getBillDispenserStatus().dispensedCount, 2)
  assert.equal(await h.api.getTotalDispensedCount(), null)
  await assert.rejects(h.api.clearTotalDispensedCount(), /지원하지 않습니다/)
})

test("missing Electron fails closed without accessing a browser device API", async () => {
  assert.equal(await load("lib/bill-acceptor-utils.ts").api.connectBillAcceptor(), false)
  assert.equal(await load("lib/bill-dispenser-utils.ts").api.connectBillDispenser(), false)
})

function printer(ipc) {
  return load("lib/printer-utils.ts", ipc, {
    "@/electron/sam4s-receipt": { buildSam4sReceiptHtml() { throw new Error("Unexpected property4 print") } },
    "@/lib/property-utils": { getKioskPropertyId: () => "property3" },
  }).api
}

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
  await assert.rejects(p.printReceipt({ hotelName: "QA", roomNumber: "B901" }), /전달하지 못했습니다/)
  assert.equal(cutCalls, 0)
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

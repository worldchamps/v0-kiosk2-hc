/**
 * ONEPLUS 지폐방출기 제어를 위한 유틸리티 함수 (Hardware 서버 연결 방식)
 */

import { hardwareCallWithin } from "@/lib/hardware-timeout"

// 지폐방출기 연결 상태
let isConnected = false

// 스트림 버퍼링 및 파싱
let streamBuffer: Uint8Array = new Uint8Array(0)
const pendingCommands = new Map<string, { resolve: (response: Uint8Array | null) => void; timeout: ReturnType<typeof setTimeout> }>()

// 지폐 방출 상태
let currentStatus: number | null = null // Unknown until the device replies.
let lastErrorCode: number | null = null
let dispensedCount = 0

// Debug logging
const ENABLE_DEBUG_LOGGING = true
const commandLog: Array<{ command: string; bytes: number[]; response?: number[]; timestamp: string; error?: string }> =
  []
const connectionLog: Array<{ event: string; details: string; timestamp: string }> = []

function logDebug(message: string): void {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[BILL_DISPENSER] ${message}`)
  }
}

function logConnection(event: string, details: string): void {
  const timestamp = new Date().toISOString()
  connectionLog.push({ event, details, timestamp })
  logDebug(`[CONNECTION] ${event}: ${details}`)
}

function logCommand(
  command: string,
  bytes: Uint8Array | number[],
  response?: Uint8Array | number[],
  error?: string,
): void {
  if (ENABLE_DEBUG_LOGGING) {
    const hexBytes = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ")
    const responseHex = response ? Array.from(response).map(b => b.toString(16).padStart(2, "0")).join(" ") : "N/A"
    console.log(`[BILL_DISPENSER CMD] ${command}: ${hexBytes} -> ${responseHex}${error ? ` ERROR: ${error}` : ""}`)
  }
}

function calculateChecksum(byte2: number, byte3: number, byte4: number): number {
  return (byte2 + byte3 + byte4) & 0xff
}

function createPacket(cmd1: number, cmd2: number, data: number): Uint8Array {
  const checksum = calculateChecksum(cmd1, cmd2, data)
  return new Uint8Array([0x24, cmd1, cmd2, data, checksum])
}

function handleIncomingData(data: { data: number[] }): void {
  const value = new Uint8Array(data.data)
  const newBuffer = new Uint8Array(streamBuffer.length + value.length)
  newBuffer.set(streamBuffer)
  newBuffer.set(value, streamBuffer.length)
  streamBuffer = newBuffer

  let searchIndex = 0
  while (searchIndex < streamBuffer.length) {
    const startIndex = streamBuffer.indexOf(0x24, searchIndex)
    if (startIndex === -1) {
      streamBuffer = new Uint8Array(0)
      break
    }
    if (startIndex + 5 > streamBuffer.length) {
      streamBuffer = streamBuffer.slice(startIndex)
      return
    }
    const packet = streamBuffer.slice(startIndex, startIndex + 5)
    if (packet[4] === calculateChecksum(packet[1], packet[2], packet[3])) {
      processReceivedPacket(packet)
      searchIndex = startIndex + 5
    } else {
      searchIndex = startIndex + 1
    }
  }
  if (searchIndex > 0) streamBuffer = streamBuffer.slice(searchIndex)
}

function processReceivedPacket(packet: Uint8Array): void {
  const cmd1 = packet[1]
  const cmd2 = packet[2]
  const data = packet[3]

  const responseKey = `${cmd1.toString(16).padStart(2, "0")}-${cmd2.toString(16).padStart(2, "0")}`
  // Status replies put the state or note count in cmd2, so wait on cmd1 only.
  const responseKeys = [responseKey, cmd1.toString(16).padStart(2, "0"), ...(cmd1 === 0x53 ? ["73"] : [])]
  for (const key of responseKeys) {
    const pendingCommand = pendingCommands.get(key)
    if (pendingCommand) {
      clearTimeout(pendingCommand.timeout)
      for (const [pendingKey, entry] of pendingCommands) {
        if (entry === pendingCommand) pendingCommands.delete(pendingKey)
      }
      pendingCommand.resolve(packet)
    }
  }

  // 상태 업데이트
  if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x74 && data === 0x62) currentStatus = 0 // 대기
  else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x6f && data === 0x6e) currentStatus = 1 // 동작중
  else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x68 && data === 0x21) currentStatus = 2 // 금지
  else if ((cmd1 === 0x73 || cmd1 === 0x53) && data === 0x6f) { // 정상 종료: s <count> o
    currentStatus = 3
    dispensedCount = cmd2
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && data === 0x6e) { // 비정상 종료: s <count> n
    currentStatus = 4
    dispensedCount = cmd2
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x65) {
    currentStatus = 4
    lastErrorCode = data
  }
}

async function sendCommand(packet: Uint8Array, expectedCmd1: number | number[], expectedCmd2?: number, timeoutMs = 1000): Promise<Uint8Array | null> {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  if (!api) return null
  const responseKeys = (Array.isArray(expectedCmd1) ? expectedCmd1 : [expectedCmd1]).map(cmd =>
    cmd.toString(16).padStart(2, "0") + (expectedCmd2 === undefined ? "" : `-${expectedCmd2.toString(16).padStart(2, "0")}`))
  const responseKey = responseKeys[0]
  if (responseKeys.some(key => pendingCommands.has(key))) return null
  const clearPending = () => { for (const key of responseKeys) pendingCommands.delete(key) }
  const entry: (typeof commandLog)[number] = { command: responseKey, bytes: Array.from(packet), timestamp: new Date().toISOString() }
  commandLog.push(entry)
  if (commandLog.length > 100) commandLog.shift()
  const responsePromise = new Promise<Uint8Array | null>((resolve) => {
    const timeout = setTimeout(() => {
      clearPending()
      resolve(null)
    }, timeoutMs)
    const pending = { resolve, timeout }
    for (const key of responseKeys) pendingCommands.set(key, pending)
  })

  const pending = pendingCommands.get(responseKey)
  const fail = () => {
    if (pending && pendingCommands.get(responseKey) === pending) {
      entry.error = "명령 전송 실패"
      clearTimeout(pending.timeout); pending.resolve(null); clearPending()
    }
  }
  try {
    Promise.resolve(api.sendToBillDispenser(Array.from(packet))).then(result => { if (result?.success !== true) fail() }, fail)
  } catch { fail() }
  const response = await responsePromise
  if (response) entry.response = Array.from(response)
  else entry.error ||= "장치 응답 시간 초과"
  return response
}

// --- 공용 API ---

export async function connectBillDispenser(): Promise<boolean> {
  logConnection("CONNECT_ATTEMPT", "하드웨어 서버 연결 상태 확인")
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  if (!api) return false
  isConnected = false
  api.onBillDispenserStatus((status: { connected: boolean }) => {
    if (!status.connected) { isConnected = false; currentStatus = null }
  })
  api.onBillDispenserData(handleIncomingData)

  // 연결될 때까지 최대 5초 대기
  const startTime = Date.now()
  let reconnectRequested = false
  while (Date.now() - startTime < 5000) {
    const remaining = () => Math.max(0, 5000 - (Date.now() - startTime))
    const status = await hardwareCallWithin(() => api.getHardwareStatus(), Math.min(1000, remaining()))
    if (!status) return false
    if (status.connected && remaining() > 0 && await checkConnection(Math.min(1000, remaining()))) break

    await new Promise(resolve => setTimeout(resolve, Math.min(500, remaining())))

    if (Date.now() - startTime > 1500 && remaining() > 0 && !reconnectRequested) {
      reconnectRequested = true
      const result = await hardwareCallWithin(() => api.reconnectBillDispenser(), Math.min(1000, remaining()))
      if (result?.success !== true) return false
    }
  }

  if (!isConnected) {
    logDebug("Connection timeout")
    return false
  }

  return true
}

export async function checkConnection(timeoutMs = 1000): Promise<boolean> {
  const packet = new Uint8Array([0x24, 0x48, 0x49, 0x3f, 0xd0]) // '$HI?'
  const res = await sendCommand(packet, 0x6d, 0x65, timeoutMs) // 'me'
  isConnected = !!res && res[1] === 0x6d && res[2] === 0x65
  return isConnected
}

export async function dispenseBills(count: number): Promise<boolean> {
  if (!Number.isInteger(count) || count < 1 || count > 250) return false
  const packet = createPacket(0x44, count, 0x53) // 'D' count 'S'
  const res = await sendCommand(packet, 0x64, count, 10000) // Timeout increased to 10s for dispensing
  const success = !!res && res[1] === 0x64 && res[2] === count
  if (success) { dispensedCount = count; currentStatus = 3 }
  return success
}

export async function dispenseBillsVerified(count: number, cashBackend: "oneplus" | "bac2400" = "oneplus"):
  Promise<{ dispensed: number | null; complete: boolean }> {
  const unknown = { dispensed: null, complete: false }
  if (!Number.isInteger(count) || count < 1 || count > 250) return unknown
  if (cashBackend === "bac2400") {
    return await dispenseBills(count) ? { dispensed: count, complete: true } : unknown
  }
  const notDispensed = { dispensed: 0, complete: false }
  const initialized = await sendCommand(createPacket(0x49, 0, 0), [0x69, 0x6e], undefined, 1500)
  if (!initialized || initialized[1] !== 0x69 || initialized[2] !== 0 || initialized[3] !== 0x61) return notDispensed
  const readyDeadline = Date.now() + 5000
  let ready = false
  while (Date.now() < readyDeadline) {
    const status = await sendCommand(createPacket(0x53, 0, 0), 0x73, undefined, Math.min(1000, readyDeadline - Date.now()))
    if (Date.now() >= readyDeadline) break
    if (status && ((status[2] === 0x74 && status[3] === 0x62) || status[3] === 0x6f)) {
      ready = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(300, readyDeadline - Date.now())))
  }
  if (!ready) return notDispensed
  const deadline = Date.now() + Math.min(count * 1500 + 5000, 40000)
  // ONEPLUS acknowledges the start, not delivery. Never repeat this command.
  const accepted = await sendCommand(createPacket(0x44, count, 0x53), [0x64, 0x6e])
  if (accepted?.[1] === 0x6e && accepted[2] === 0x73 && accepted[3] === 0x21) {
    return { dispensed: 0, complete: false }
  }
  if (!accepted || accepted[1] !== 0x64 || accepted[2] !== count || accepted[3] !== 0x61) return unknown
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(300, deadline - Date.now())))
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const status = await sendCommand(createPacket(0x53, 0, 0), 0x73, undefined, Math.min(1000, remaining))
    if (!status || Date.now() >= deadline) return unknown
    if (status[2] === 0x6f && status[3] === 0x6e) continue
    if (status[2] <= count && (status[3] === 0x6f || status[3] === 0x6e)) {
      // Spec V9.6: "s <n> n" also covers a normal payout followed by SENS_EMPTY, so all notes out is complete.
      return { dispensed: status[2], complete: status[2] === count }
    }
    return unknown
  }
  return unknown
}

export async function getDispenserStatus(): Promise<number> {
  const res = await sendCommand(createPacket(0x53, 0, 0), 0x73)
  if (!res) return -1
  if ((res[2] === 0x74 && res[3] === 0x62) || res[3] === 0x6f) return 0x62
  if (res[2] === 0x6f && res[3] === 0x6e) return 0x6f
  if (res[2] === 0x68 && res[3] === 0x21) return 0x21
  if (res[3] === 0x6e || res[2] === 0x65) return 0x65
  return -1
}

export function isBillDispenserConnected(): boolean {
  return isConnected
}

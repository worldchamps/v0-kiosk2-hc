/**
 * ONEPLUS 지폐방출기 제어를 위한 유틸리티 함수 (Hardware 서버 연결 방식)
 */

declare global {
  interface Window {
    electronAPI: any
  }
}

// 지폐방출기 연결 상태
let isConnected = false

// 스트림 버퍼링 및 파싱
let streamBuffer: Uint8Array = new Uint8Array(0)
const pendingCommands: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map()

// 지폐 방출 상태
let currentStatus = 0 // 0: 대기, 1: 동작중, 2: 금지, 3: 완료
let lastErrorCode = 0
let dispensedCount = 0
let isOldProtocol = true

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
      break
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
  const pendingCommand = pendingCommands.get(responseKey)

  if (pendingCommand) {
    clearTimeout(pendingCommand.timeout)
    pendingCommands.delete(responseKey)
    pendingCommand.resolve(packet)
  }

  // 상태 업데이트
  if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x74 && data === 0x62) currentStatus = 0 // 대기
  else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x6f && data === 0x6e) currentStatus = 1 // 동작중
  else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x68 && data === 0x21) currentStatus = 2 // 금지
  else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x6f) { // 완료
    currentStatus = 3
    dispensedCount = data
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x65) lastErrorCode = data // 에러
}

async function sendCommand(packet: Uint8Array, expectedCmd1: number, expectedCmd2: number, timeoutMs = 1000): Promise<Uint8Array | null> {
  if (!isConnected) return null
  const responseKey = `${expectedCmd1.toString(16).padStart(2, "0")}-${expectedCmd2.toString(16).padStart(2, "0")}`
  const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommands.delete(responseKey)
      reject(new Error("Timeout"))
    }, timeoutMs)
    pendingCommands.set(responseKey, { resolve, reject, timeout })
  })

  const success = await window.electronAPI.sendToBillDispenser(Array.from(packet))
  if (!success) {
    pendingCommands.delete(responseKey)
    return null
  }
  try { return await responsePromise } catch (e) { return null }
}

// --- 공용 API ---

export async function connectBillDispenser(): Promise<boolean> {
  logConnection("CONNECT_ATTEMPT", "하드웨어 서버 연결 상태 확인")
  window.electronAPI.onBillDispenserStatus((status: { connected: boolean }) => {
    isConnected = status.connected
  })
  window.electronAPI.onBillDispenserData(handleIncomingData)

  // 연결될 때까지 최대 5초 대기
  const startTime = Date.now()
  while (Date.now() - startTime < 5000) {
    const status = await window.electronAPI.getHardwareStatus()
    isConnected = status.connected

    if (isConnected) break

    await new Promise(resolve => setTimeout(resolve, 500))

    if (Date.now() - startTime > 1500 && !isConnected) {
      await window.electronAPI.reconnectBillDispenser()
    }
  }

  if (!isConnected) {
    logDebug("Connection timeout")
    return false
  }

  return true
}

export async function disconnectBillDispenser(): Promise<void> {
  isConnected = false
}

export async function checkConnection(): Promise<boolean> {
  const packet = new Uint8Array([0x24, 0x48, 0x49, 0x3f, 0xd0]) // '$HI?'
  const res = await sendCommand(packet, 0x6d, 0x65) // 'me'
  return !!res && res[1] === 0x6d && res[2] === 0x65
}

export async function dispenseBills(count: number): Promise<boolean> {
  if (count < 1 || count > 250) return false
  const packet = createPacket(0x44, count, 0x53) // 'D' count 'S'
  const res = await sendCommand(packet, 0x64, count, 10000) // Timeout increased to 10s for dispensing
  return !!res && res[1] === 0x64 && res[2] === count
}

export async function getDispenserStatus(): Promise<number> {
  // Command: $ S t ? (Check Status)
  const packet = createPacket(0x53, 0x74, 0x3f)
  const res = await sendCommand(packet, 0x73, 0x74) // Expect: $ s t [status]

  if (res) {
    // Status Byte (res[3]):
    // 0x62 ('b') = Idle / Ready
    // 0x6f ('o') = Busy / Dispensing
    // 0x65 ('e') = Error
    // 0x21 ('!') = Inhibited / Stop
    return res[3]
  }
  return -1 // Unknown
}

export async function resetDispenser(): Promise<boolean> {
  const cmd1 = isOldProtocol ? 0x49 : 0x69
  const packet = createPacket(cmd1, 0x00, 0x00)
  const expectedCmd1 = isOldProtocol ? 0x69 : 0x49
  const res = await sendCommand(packet, expectedCmd1, 0x00)
  return !!res
}

export async function enableDispenser(): Promise<boolean> {
  const cmd1 = isOldProtocol ? 0x48 : 0x68
  const cmd2 = isOldProtocol ? 0x43 : 0x63
  const packet = createPacket(cmd1, cmd2, 0x3f)
  const expectedCmd1 = isOldProtocol ? 0x68 : 0x48
  const expectedCmd2 = isOldProtocol ? 0x63 : 0x43
  const res = await sendCommand(packet, expectedCmd1, expectedCmd2)
  return !!res
}

export function isBillDispenserConnected(): boolean {
  return isConnected
}

/**
 * ONEPLUS 지폐인식기 제어를 위한 유틸리티 함수 (Hardware 서버 연결 방식)
 */

declare global {
  interface Window {
    electronAPI: any
  }
}

// 지폐인식기 연결 상태 (이제 하드웨어 서버와의 연결 상태를 나타냄)
let isConnected = false

// 스트림 버퍼링 및 파싱
let streamBuffer: Uint8Array = new Uint8Array(0)
const pendingCommands: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map()

// 지폐 인식 상태
let isAcceptingBills = false
let currentStatus = 0x01 // WAIT

// 이벤트 처리 상태
let eventProcessingEnabled = false
let lastEventMessage: { command: string; data: number; timestamp: string } | null = null

// 이벤트 콜백
let eventCallback: ((eventData: number) => void) | null = null

// Debug logging
const ENABLE_DEBUG_LOGGING = true
const commandLog: Array<{ command: string; bytes: number[]; response?: number[]; timestamp: string; error?: string }> =
  []
const connectionLog: Array<{ event: string; details: string; timestamp: string }> = []

function logDebug(message: string): void {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[BILL_ACCEPTOR] ${message}`)
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
    const hexBytes = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
    const responseHex = response
      ? Array.from(response)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")
      : "N/A"
    const timestamp = new Date().toISOString()
    console.log(`[BILL_ACCEPTOR CMD] ${command}: ${hexBytes} -> ${responseHex}${error ? ` ERROR: ${error}` : ""}`)
    commandLog.push({
      command: command,
      bytes: Array.from(bytes),
      response: response ? Array.from(response) : undefined,
      timestamp,
      error,
    })
  }
}

function calculateChecksum(byte2: number, byte3: number, byte4: number): number {
  return (byte2 + byte3 + byte4) & 0xff
}

function createPacket(cmd1: number, cmd2: number, data: number): Uint8Array {
  const checksum = calculateChecksum(cmd1, cmd2, data)
  return new Uint8Array([0x24, cmd1, cmd2, data, checksum])
}

function validatePacket(packet: Uint8Array): boolean {
  if (packet.length !== 5) return false
  if (packet[0] !== 0x24) return false
  const expectedChecksum = calculateChecksum(packet[1], packet[2], packet[3])
  return packet[4] === expectedChecksum
}

// IPC로부터 데이터를 전달받아 버퍼링 및 파싱하는 함수
function handleIncomingData(data: { data: number[] }): void {
  const value = new Uint8Array(data.data)
  const newBuffer = new Uint8Array(streamBuffer.length + value.length)
  newBuffer.set(streamBuffer)
  newBuffer.set(value, streamBuffer.length)
  streamBuffer = newBuffer

  logDebug(`데이터 수신: ${Array.from(value).map(b => b.toString(16).padStart(2, "0")).join(" ")}`)

  // 패킷 파싱
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
    if (validatePacket(packet)) {
      processReceivedPacket(packet)
      searchIndex = startIndex + 5
    } else {
      searchIndex = startIndex + 1
    }
  }

  if (searchIndex > 0) {
    streamBuffer = streamBuffer.slice(searchIndex)
  }
}

async function processReceivedPacket(packet: Uint8Array): Promise<void> {
  const cmd1 = packet[1]
  const cmd2 = packet[2]
  const data = packet[3]

  // 이벤트 메시지 처리 ($ES)
  if (cmd1 === 0x45 && cmd2 === 0x53) {
    handleEventMessage(packet)
    return
  }

  const responseKey = `${cmd1.toString(16).padStart(2, "0")}-${cmd2.toString(16).padStart(2, "0")}`
  const pendingCommand = pendingCommands.get(responseKey)

  if (pendingCommand) {
    clearTimeout(pendingCommand.timeout)
    pendingCommands.delete(responseKey)
    pendingCommand.resolve(packet)
  } else {
    // NG 응답 처리
    if (cmd1 === 0x4e && cmd2 === 0x47) {
      const okKey = "4f-4b" // 'O'-'K'
      const okCommand = pendingCommands.get(okKey)
      if (okCommand) {
        clearTimeout(okCommand.timeout)
        pendingCommands.delete(okKey)
        okCommand.resolve(packet)
      }
    } else {
      logDebug(`Unmatched response: ${responseKey} (Waiting for: ${Array.from(pendingCommands.keys()).join(", ")})`)
    }
  }
}

function handleEventMessage(packet: Uint8Array): void {
  const eventData = packet[3]
  logConnection("EVENT_RECEIVED", `이벤트: 0x${eventData.toString(16).padStart(2, "0")} (${getStatusString(eventData)})`)

  lastEventMessage = {
    command: "Event Status",
    data: eventData,
    timestamp: new Date().toISOString(),
  }

  if (eventCallback) {
    eventCallback(eventData)
  }
}

// 명령어 전송 및 응답 대기
async function sendCommand(packet: Uint8Array, expectedCmd1: number, expectedCmd2: number, timeoutMs = 3000): Promise<Uint8Array | null> {
  if (!isConnected) return null

  const responseKey = `${expectedCmd1.toString(16).padStart(2, "0")}-${expectedCmd2.toString(16).padStart(2, "0")}`

  const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommands.delete(responseKey)
      reject(new Error("Timeout"))
    }, timeoutMs)
    pendingCommands.set(responseKey, { resolve, reject, timeout })
  })

  const success = await window.electronAPI.sendToBillAcceptor(Array.from(packet))
  if (!success) {
    pendingCommands.delete(responseKey)
    return null
  }

  try {
    return await responsePromise
  } catch (e) {
    return null
  }
}

// --- 공용 API ---

export async function connectBillAcceptor(): Promise<boolean> {
  logConnection("CONNECT_ATTEMPT", "하드웨어 서버 연결 상태 확인")

  // Electron에서 상태 수신 대기 설정
  window.electronAPI.onBillAcceptorStatus((status: { connected: boolean }) => {
    isConnected = status.connected
    logConnection("STATUS_CHANGED", `연결 상태: ${isConnected ? "Connected" : "Disconnected"}`)
  })

  window.electronAPI.onBillAcceptorData(handleIncomingData)

  // 잠시 대기하여 초기 상태를 확인 (하드웨어 브리지가 정보를 주도록)
  // 연결될 때까지 최대 5초 대기
  const startTime = Date.now()
  while (Date.now() - startTime < 5000) {
    // Active polling of status
    const status = await window.electronAPI.getHardwareStatus()
    isConnected = status.connected

    if (isConnected) break

    await new Promise(resolve => setTimeout(resolve, 500))

    // 연결 시도가 없으면 재연결 요청 (한번만)
    if (Date.now() - startTime > 1500 && !isConnected) {
      await window.electronAPI.reconnectBillAcceptor()
    }
  }

  if (!isConnected) {
    logDebug("Connection timeout")
    return false
  }

  return true // 연결 성공
}

export async function disconnectBillAcceptor(): Promise<void> {
  isConnected = false
}

export async function checkConnection(): Promise<boolean> {
  const packet = createPacket(0x48, 0x69, 0x3f) // 'H' 'i' '?'
  const res = await sendCommand(packet, 0x6d, 0x65) // 'm' 'e'
  return !!res && res[1] === 0x6d && res[2] === 0x65
}

export async function getStatus(): Promise<number | null> {
  const packet = createPacket(0x47, 0x41, 0x3f) // 'G' 'A' '?'
  const res = await sendCommand(packet, 0x67, 0x61) // 'g' 'a'
  return res ? res[3] : null
}

export async function getBillData(): Promise<number | null> {
  const packet = createPacket(0x47, 0x42, 0x3f) // 'G' 'B' '?'
  const res = await sendCommand(packet, 0x67, 0x62) // 'g' 'b'
  return res ? res[3] : null
}

export async function enableAcceptance(): Promise<boolean> {
  const packet = createPacket(0x53, 0x41, 0x0d) // 'S' 'A' 0x0D
  const res = await sendCommand(packet, 0x4f, 0x4b)
  if (res && res[1] === 0x4f && res[2] === 0x4b) {
    isAcceptingBills = true
    return true
  }
  return false
}

export async function disableAcceptance(): Promise<boolean> {
  const packet = createPacket(0x53, 0x41, 0x0e) // 'S' 'A' 0x0E
  const res = await sendCommand(packet, 0x4f, 0x4b)
  if (res && (res[1] === 0x4f || res[1] === 0x4e)) { // OK or NG
    isAcceptingBills = false
    return true
  }
  return false
}

export async function stackBill(): Promise<boolean> {
  const packet = createPacket(0x53, 0x41, 0x09) // 'S' 'A' 0x09
  const res = await sendCommand(packet, 0x4f, 0x4b)
  return res ? (res[1] === 0x4f && res[2] === 0x4b) : false
}

export async function returnBill(): Promise<boolean> {
  const packet = createPacket(0x53, 0x41, 0x06) // 'S' 'A' 0x06
  const res = await sendCommand(packet, 0x4f, 0x4b)
  return res ? (res[1] === 0x4f && res[2] === 0x4b) : false
}

export async function setConfig(config: number): Promise<boolean> {
  const packet = createPacket(0x53, 0x43, config) // 'S' 'C' config
  const res = await sendCommand(packet, 0x4f, 0x4b)
  return res ? (res[1] === 0x4f && res[2] === 0x4b) : false
}

export async function initializeDevice(): Promise<boolean> {
  const packet = createPacket(0x52, 0x53, 0x54) // 'R' 'S' 'T'
  const res = await sendCommand(packet, 0x4f, 0x4b, 3000)
  return res ? (res[1] === 0x4f && res[2] === 0x4b) : false
}

export function setEventCallback(callback: ((eventData: number) => void) | null): void {
  eventCallback = callback
}

export function isBillAcceptorConnected(): boolean {
  return isConnected
}

export function getStatusString(status: number): string {
  switch (status) {
    case 0x01: return "WAIT (대기)"
    case 0x02: return "START_WAIT (수취 준비)"
    case 0x05: return "RECOGNITION_END (인식 완료)"
    case 0x08: return "RETURN_END (반환 완료)"
    case 0x0b: return "STACK_END (적재 완료)"
    case 0x0c: return "ERROR_WAIT (오류 대기)"
    default: return `UNKNOWN (0x${status.toString(16)})`
  }
}

export function getBillAcceptorDiagnostics() {
  return {
    isConnected,
    isAcceptingBills,
    currentStatus: currentStatus,
    eventProcessingEnabled,
    lastEventMessage
  };
}

export function getBillAcceptorStatus() {
  return currentStatus;
}

export function getLastEventMessage() {
  return lastEventMessage;
}

export function getBillAcceptorCommandLog() {
  return commandLog;
}

export function getVersion(): string {
  return "2.0 (Hardware Bridge)";
}

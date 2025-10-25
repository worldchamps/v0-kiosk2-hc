/**
 * 열전사 프린터 연결 및 제어를 위한 유틸리티 함수
 * 지원 모델: BK3-3, SAM4S ELLIX/GIANT
 */

// 프린터 연결 상태
let printerPort: SerialPort | null = null
let printerWriter: WritableStreamDefaultWriter | null = null
let lastConnectedPortInfo: any = null // 마지막으로 연결된 포트 정보 저장
let detectedPrinterModel: "BK3-3" | "SAM4S" | "UNKNOWN" = "UNKNOWN"

// Print mode setting
let simplePrintMode = false

// Debug logging
const ENABLE_DEBUG_LOGGING = true
const commandLog: Array<{ command: string; bytes: number[]; timestamp: string }> = []

/**
 * 디버그 로그 함수
 */
function logDebug(message: string): void {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[PRINTER] ${message}`)
  }
}

/**
 * 명령어 로그 함수
 */
function logCommand(command: string, bytes: Uint8Array | number[]): void {
  if (ENABLE_DEBUG_LOGGING) {
    const hexBytes = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
    const timestamp = new Date().toISOString()
    console.log(`[PRINTER CMD] ${command}: ${hexBytes}`)
    commandLog.push({
      command,
      bytes: Array.from(bytes),
      timestamp,
    })
  }
}

/**
 * 명령어 로그 가져오기
 */
export function getCommandLog(): Array<{ command: string; bytes: number[]; timestamp: string }> {
  return [...commandLog]
}

/**
 * 명령어 로그 지우기
 */
export function clearCommandLog(): void {
  commandLog.length = 0
}

/**
 * 프린터 모델 감지 함수
 */
async function detectPrinterModel(): Promise<void> {
  try {
    // 프린터 정보 요청 명령 (GS I)
    const infoCommand = new Uint8Array([0x1d, 0x49, 0x01])

    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않아 모델을 감지할 수 없습니다.")
      return
    }

    // 명령 로깅
    logCommand("GS I (Printer Info)", infoCommand)

    // 명령 전송
    await printerWriter.write(infoCommand)

    // 실제로는 응답을 읽어야 하지만, Web Serial API에서는 복잡함
    // 대신 연결 정보를 기반으로 추측
    if (lastConnectedPortInfo) {
      const vendorId = lastConnectedPortInfo.usbVendorId
      const productId = lastConnectedPortInfo.usbProductId

      // 일반적인 SAM4S 프린터의 USB VID/PID (예시)
      if (vendorId === 0x1504 || vendorId === 0x0483) {
        detectedPrinterModel = "SAM4S"
        logDebug("SAM4S 프린터로 감지되었습니다.")
      }
      // 일반적인 BK3-3 프린터의 USB VID/PID (예시)
      else if (vendorId === 0x0416 || vendorId === 0x0483) {
        detectedPrinterModel = "BK3-3"
        logDebug("BK3-3 프린터로 감지되었습니다.")
      } else {
        detectedPrinterModel = "UNKNOWN"
        logDebug(`알 수 없는 프린터 모델: VID=${vendorId.toString(16)}, PID=${productId.toString(16)}`)
      }
    }

    // 프린터 모델 정보 저장
    try {
      localStorage.setItem("detectedPrinterModel", detectedPrinterModel)
    } catch (e) {
      logDebug("프린터 모델 정보를 저장하지 못했습니다: " + e)
    }
  } catch (error) {
    logDebug("프린터 모델 감지 중 오류 발생: " + error)
  }
}

/**
 * 저장된 프린터 모델 정보 로드
 */
function loadSavedPrinterModel(): void {
  try {
    const savedModel = localStorage.getItem("detectedPrinterModel") as "BK3-3" | "SAM4S" | "UNKNOWN" | null
    if (savedModel) {
      detectedPrinterModel = savedModel
      logDebug(`저장된 프린터 모델 정보를 로드했습니다: ${savedModel}`)
    }
  } catch (e) {
    logDebug("저장된 프린터 모델 정보를 로드하지 못했습니다: " + e)
  }
}

/**
 * 프린터 모델 가져오기
 */
export function getPrinterModel(): string {
  return detectedPrinterModel
}

/**
 * Simple Mode 설정 함수
 */
export function setSimplePrintMode(simple: boolean): void {
  simplePrintMode = simple
  logDebug(`Simple Mode ${simple ? "활성화" : "비활성화"}됨`)

  // Save preference to localStorage
  try {
    localStorage.setItem("simplePrintMode", simple ? "true" : "false")
  } catch (e) {
    logDebug("Simple Mode 설정을 저장하지 못했습니다: " + e)
  }
}

/**
 * Simple Mode 상태 확인 함수 - 환경 변수, 프린터 모델, 저장된 설정을 모두 고려
 */
export function getSimplePrintMode(): boolean {
  // 1. 환경 변수 확인 (최우선)
  if (typeof process !== "undefined" && process.env && process.env.PRINTER_SIMPLE_MODE === "true") {
    logDebug("환경 변수에서 Simple Mode 활성화됨")
    return true
  }

  // 2. 프린터 모델에 따른 기본값 설정
  if (detectedPrinterModel === "SAM4S") {
    // SAM4S는 기본적으로 Simple Mode 사용
    const defaultMode = true
    logDebug(`SAM4S 프린터 감지: 기본 Simple Mode=${defaultMode}`)

    // 저장된 설정이 있으면 그것을 우선
    try {
      const savedMode = localStorage.getItem("simplePrintMode")
      if (savedMode !== null) {
        const mode = savedMode === "true"
        logDebug(`SAM4S 프린터: 저장된 설정 사용 Simple Mode=${mode}`)
        return mode
      }
    } catch (e) {
      logDebug("저장된 Simple Mode 설정을 로드하지 못했습니다: " + e)
    }

    return defaultMode
  }

  // 3. 저장된 설정 확인
  try {
    const savedMode = localStorage.getItem("simplePrintMode")
    if (savedMode !== null) {
      const mode = savedMode === "true"
      logDebug(`저장된 설정 사용 Simple Mode=${mode}`)
      return mode
    }
  } catch (e) {
    logDebug("저장된 Simple Mode 설정을 로드하지 못했습니다: " + e)
  }

  // 4. 기본값 (BK3-3는 기본적으로 Rich Mode 사용)
  logDebug(`기본값 사용 Simple Mode=${simplePrintMode}`)
  return simplePrintMode
}

// ESC/POS 명령어 상수
const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c
const LF = 0x0a
const CR = 0x0d

/**
 * 프린터 연결 함수 - 사용자가 포트를 선택하도록 수정
 */
export async function connectPrinter(): Promise<boolean> {
  try {
    // Web Serial API support check
    if (!("serial" in navigator)) {
      logDebug("Web Serial API is not supported in this browser.")
      return false
    }

    // If already connected, reuse the connection
    if (printerPort && printerWriter) {
      logDebug("Printer is already connected.")
      return true
    }

    // 저장된 프린터 모델 정보 로드
    loadSavedPrinterModel()

    // Try to get previously stored port info
    let storedPortInfo = null
    try {
      const storedInfo = localStorage.getItem("lastPrinterPortInfo")
      if (storedInfo) {
        storedPortInfo = JSON.parse(storedInfo)
        logDebug("Found stored printer port info: " + JSON.stringify(storedPortInfo))
      }
    } catch (e) {
      logDebug("Failed to retrieve stored port info: " + e)
    }

    // Try to reconnect to previously used port first
    if (storedPortInfo) {
      try {
        logDebug("Attempting to reconnect to previously used printer...")
        const ports = await (navigator as any).serial.getPorts()

        for (const port of ports) {
          const info = port.getInfo ? await port.getInfo() : {}

          // Check if this port matches our stored info
          if (info.usbVendorId === storedPortInfo.usbVendorId && info.usbProductId === storedPortInfo.usbProductId) {
            printerPort = port
            logDebug("Found previously connected printer!")
            break
          }
        }
      } catch (err) {
        logDebug("Failed to auto-reconnect to printer: " + err)
      }
    }

    // If we couldn't reconnect automatically, ask user to select a port
    if (!printerPort) {
      try {
        logDebug("Requesting user to select a printer port...")
        printerPort = await (navigator as any).serial.requestPort()
      } catch (err) {
        logDebug("User cancelled port selection: " + err)
        return false
      }
    }

    // Open the port
    await printerPort.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "hardware",
    })

    // Set up the output stream
    const writableStream = printerPort.writable
    printerWriter = writableStream.getWriter()

    // Save connection info
    lastConnectedPortInfo = printerPort.getInfo ? await printerPort.getInfo() : { usbVendorId: 0, usbProductId: 0 }

    // Store port info in localStorage for future reconnections
    try {
      localStorage.setItem("lastPrinterPortInfo", JSON.stringify(lastConnectedPortInfo))
      logDebug("Saved printer port info to localStorage: " + JSON.stringify(lastConnectedPortInfo))
    } catch (e) {
      logDebug("Failed to save port info to localStorage: " + e)
    }

    // Initialize printer
    await initializePrinter()

    // Detect printer model
    await detectPrinterModel()

    logDebug("Printer connected successfully.")
    return true
  } catch (error) {
    logDebug("Error connecting to printer: " + error)
    return false
  }
}

// Update the autoConnectPrinter function to use stored port info
export async function autoConnectPrinter(): Promise<boolean> {
  try {
    // Web Serial API support check
    if (!("serial" in navigator)) {
      logDebug("Web Serial API is not supported in this browser.")
      return false
    }

    // If already connected, reuse the connection
    if (printerPort && printerWriter) {
      logDebug("Printer is already connected.")
      return true
    }

    // 저장된 프린터 모델 정보 로드
    loadSavedPrinterModel()

    // Try to get previously stored port info
    let storedPortInfo = null
    try {
      const storedInfo = localStorage.getItem("lastPrinterPortInfo")
      if (storedInfo) {
        storedPortInfo = JSON.parse(storedInfo)
        logDebug("Found stored printer port info for auto-connect: " + JSON.stringify(storedPortInfo))
      }
    } catch (e) {
      logDebug("Failed to retrieve stored port info: " + e)
    }

    // Get list of available ports
    const ports = await (navigator as any).serial.getPorts()

    if (ports.length === 0) {
      logDebug("No available ports. User interaction required.")
      return await connectPrinter() // Fall back to regular connection function
    }

    // Try to find the previously used port first
    if (storedPortInfo) {
      for (const port of ports) {
        const info = port.getInfo ? await port.getInfo() : {}

        // Check if this port matches our stored info
        if (info.usbVendorId === storedPortInfo.usbVendorId && info.usbProductId === storedPortInfo.usbProductId) {
          printerPort = port
          logDebug("Auto-reconnected to previously used printer!")
          break
        }
      }
    }

    // If we couldn't find the previously used port, use the first available port
    if (!printerPort) {
      printerPort = ports[0]
      logDebug("Using first available port for auto-connect.")
    }

    // Open the port
    await printerPort.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "hardware",
    })

    // Set up the output stream
    const writableStream = printerPort.writable
    printerWriter = writableStream.getWriter()

    // Save connection info
    lastConnectedPortInfo = printerPort.getInfo ? await printerPort.getInfo() : { usbVendorId: 0, usbProductId: 0 }

    // Store port info in localStorage for future reconnections
    try {
      localStorage.setItem("lastPrinterPortInfo", JSON.stringify(lastConnectedPortInfo))
    } catch (e) {
      logDebug("Failed to save port info to localStorage: " + e)
    }

    // Initialize printer
    await initializePrinter()

    // Detect printer model
    await detectPrinterModel()

    logDebug("Printer auto-connected successfully.")
    return true
  } catch (error) {
    logDebug("Error auto-connecting to printer: " + error)
    return false
  }
}

/**
 * 프린터 연결 해제 함수
 */
export async function disconnectPrinter(): Promise<void> {
  try {
    if (printerWriter) {
      await printerWriter.close()
      printerWriter = null
    }

    if (printerPort) {
      await printerPort.close()
      printerPort = null
    }

    logDebug("프린터 연결이 해제되었습니다.")
  } catch (error) {
    logDebug("프린터 연결 해제 중 오류 발생: " + error)
  }
}

/**
 * 텍스트 인쇄 함수 - 명령어 로깅 추가
 */
export async function printText(text: string): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    // ASCII 텍스트만 처리 (영어, 숫자, 특수문자)
    const encoded = new TextEncoder().encode(text)

    // 명령 로깅
    logCommand("TEXT", encoded)

    await printerWriter.write(encoded)

    return true
  } catch (error) {
    logDebug("텍스트 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 초기화 명령 전송 - 프린터 모델별 최적화
 */
export async function initializePrinter(): Promise<boolean> {
  try {
    console.log("Initializing printer...")

    // 프린터 초기화 명령 전송
    const initCommand = "\x1B\x40" // ESC @ (프린터 초기화)

    return await sendToPrinter(initCommand)
  } catch (error) {
    console.error("Printer initialization error:", error)
    return false
  }
}

/**
 * 프린터 상태 확인 함수
 */
export function isPrinterConnected(): boolean {
  try {
    // 실제 환경에서는 프린터 연결 상태를 확인하는 로직
    // 현재는 개발 환경을 위해 항상 true 반환
    return true
  } catch (error) {
    console.error("프린터 연결 확인 오류:", error)
    return false
  }
}

/**
 * 프린터 진단 정보 가져오기
 */
export function getPrinterDiagnostics(): any {
  return {
    connected: isPrinterConnected(),
    model: detectedPrinterModel,
    simpleMode: getSimplePrintMode(),
    environmentVariables: {
      PRINTER_SIMPLE_MODE: process.env.PRINTER_SIMPLE_MODE || "not set",
      FORCE_SIMPLE_FOR_BK3: process.env.FORCE_SIMPLE_FOR_BK3 || "not set",
    },
    connectionInfo: lastConnectedPortInfo,
    commandLog: commandLog.slice(-10), // 최근 10개 명령만 반환
  }
}

interface ReceiptItem {
  label: string
  value: string
}

interface ReceiptData {
  guestName: string
  roomCode: string // roomNumber 대신 roomCode 사용
  roomType: string
  checkInDate: string
  checkOutDate: string
  password: string
  reservationId: string
  totalAmount: number
  printTime: string
}

interface PrintResult {
  success: boolean
  error?: string
}

/**
 * 영수증 인쇄 함수 - 모드에 따라 다른 형식 사용
 */
export async function printReceipt(data: ReceiptData): Promise<boolean> {
  try {
    console.log("Printing receipt with data:", data)

    // 개발 환경에서는 콘솔에 출력
    if (process.env.NODE_ENV === "development") {
      console.log("=== 영수증 출력 (개발 모드) ===")
      console.log(`예약자명: ${data.guestName}`)
      console.log(`객실번호: ${data.roomCode}`) // roomCode 사용
      console.log(`객실타입: ${data.roomType}`)
      console.log(`체크인: ${data.checkInDate}`)
      console.log(`체크아웃: ${data.checkOutDate}`)
      console.log(`출입번호: ${data.password}`)
      console.log(`예약번호: ${data.reservationId}`)
      console.log(`결제금액: ${data.totalAmount.toLocaleString()}원`)
      console.log(`출력시간: ${data.printTime}`)
      console.log("================================")
      return true
    }

    // 실제 프린터 연결 시도
    const printCommand = createPrintCommand(data)

    // 프린터 포트 연결 시도 (예: COM3, /dev/ttyUSB0 등)
    const success = await sendToPrinter(printCommand)

    return success
  } catch (error) {
    console.error("Print error:", error)
    return false
  }
}

/**
 * 프린터 명령어 생성
 */
function createPrintCommand(data: ReceiptData): string {
  const lines = [
    "더 비치스테이",
    "체크인 영수증",
    data.printTime,
    "--------------------------------",
    `예약자명: ${data.guestName}`,
    `객실번호: ${data.roomCode}`, // roomCode 사용
    `객실타입: ${data.roomType}`,
    `체크인: ${data.checkInDate}`,
    `체크아웃: ${data.checkOutDate}`,
    `출입번호: ${data.password}`,
    `예약번호: ${data.reservationId}`,
    `결제금액: ${data.totalAmount.toLocaleString()}원`,
    "--------------------------------",
    "감사합니다",
    "즐거운 여행 되세요!",
    "",
    "",
    "", // 여백을 위한 빈 줄들
  ]

  return lines.join("\n")
}

/**
 * 실제 프린터로 데이터 전송
 */
async function sendToPrinter(command: string): Promise<boolean> {
  try {
    // 실제 환경에서는 시리얼 포트나 USB 프린터로 전송
    // 여기서는 시뮬레이션

    console.log("Sending to printer:", command)

    // 프린터 연결 시뮬레이션
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return true
  } catch (error) {
    console.error("Printer communication error:", error)
    return false
  }
}

/**
 * 프린터 상태 확인
 */
export async function checkPrinterStatus(): Promise<{
  connected: boolean
  paperStatus: "ok" | "low" | "empty"
  error?: string
}> {
  try {
    // 실제 환경에서는 프린터 상태를 확인
    // 개발 환경에서는 시뮬레이션

    if (process.env.NODE_ENV === "development") {
      return {
        connected: true,
        paperStatus: "ok",
      }
    }

    // 실제 프린터 상태 확인 로직
    return {
      connected: false,
      paperStatus: "ok",
      error: "Printer not connected",
    }
  } catch (error) {
    return {
      connected: false,
      paperStatus: "ok",
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * 열전사 프린터 연결 및 제어를 위한 유틸리티 함수
 * 표준 ESC/POS 명령어 사용 (모든 프린터 호환)
 */

interface WebSerialPort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  getInfo(): { usbVendorId?: number; usbProductId?: number }
  open(options: { baudRate: number; dataBits: number; stopBits: number; parity: "none"; flowControl: "none" }): Promise<void>
  close(): Promise<void>
}
type SerialNavigator = Navigator & { serial: { requestPort(): Promise<WebSerialPort>; getPorts(): Promise<WebSerialPort[]> } }
// 프린터 연결 상태
let printerPort: WebSerialPort | null = null
let printerWriter: WritableStreamDefaultWriter | null = null

// Print mode setting
let simplePrintMode = true

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
 * 프린터 모델 가져오기 (간소화 - 항상 "STANDARD"로 반환)
 */
export function getPrinterModel(): string {
  return "STANDARD"
}

/**
 * Simple Mode 설정 함수
 */
export function setSimplePrintMode(simple: boolean): void {
  simplePrintMode = simple
  logDebug(`Simple Mode ${simple ? "활성화" : "비활성화"}됨`)

  try {
    localStorage.setItem("simplePrintMode", simple ? "true" : "false")
  } catch (e) {
    logDebug("Simple Mode 설정을 저장하지 못했습니다: " + e)
  }
}

/**
 * Simple Mode 상태 확인 함수
 */
export function getSimplePrintMode(): boolean {
  if (typeof process !== "undefined" && process.env) {
    if (process.env.NEXT_PUBLIC_FORCE_SIMPLE_MODE === "true") {
      logDebug("NEXT_PUBLIC_FORCE_SIMPLE_MODE 환경 변수로 Simple Mode 강제 활성화")
      return true
    }
    if (process.env.PRINTER_SIMPLE_MODE === "true") {
      logDebug("PRINTER_SIMPLE_MODE 환경 변수로 Simple Mode 활성화")
      return true
    }
  }

  // 2. 저장된 설정 확인
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

  // 3. 기본값
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
 * 프린터 연결 함수
 */
export async function connectPrinter(): Promise<boolean> {
  try {
    logDebug("🔌 프린터 연결 시작...")

    // Web Serial API support check
    if (!("serial" in navigator)) {
      logDebug("❌ Web Serial API가 이 브라우저에서 지원되지 않습니다.")
      return false
    }

    // If already connected, reuse the connection
    if (printerPort && printerWriter) {
      logDebug("✅ 프린터가 이미 연결되어 있습니다.")
      if (printerPort.readable && printerPort.writable) {
        logDebug("✅ 포트가 열려 있고 쓰기 가능한 상태입니다.")
        return true
      } else {
        logDebug("⚠️ 포트 상태가 비정상입니다. 재연결을 시도합니다.")
        printerPort = null
        printerWriter = null
      }
    }

    // 사용자에게 포트 선택 요청
    try {
      logDebug("👤 사용자에게 포트 선택 요청 중...")
      printerPort = await (navigator as SerialNavigator).serial.requestPort()
      const portInfo = printerPort.getInfo()
      logDebug(`✅ 사용자가 포트를 선택했습니다: USB Vendor=${portInfo.usbVendorId}, Product=${portInfo.usbProductId}`)
    } catch (err) {
      logDebug(`❌ 사용자가 포트 선택을 취소했습니다: ${err}`)
      return false
    }

    // Open the port
    logDebug("🔓 포트 열기 시도 중... (115200 bps)")
    try {
      await printerPort.open({
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none", // Bixolon은 hardware flow control 미지원
      })
      logDebug("✅ 포트가 성공적으로 열렸습니다.")
    } catch (err) {
      logDebug(`❌ 포트 열기 실패: ${err}`)
      return false
    }

    // Set up the output stream
    if (!printerPort.writable) {
      logDebug("❌ 포트에 쓰기 가능한 스트림이 없습니다!")
      return false
    }

    const writableStream = printerPort.writable
    printerWriter = writableStream.getWriter()
    logDebug("✅ Writer 스트림을 설정했습니다.")

    // Initialize printer
    logDebug("🔧 프린터 초기화 중...")
    const initSuccess = await initializePrinter()
    if (!initSuccess) {
      logDebug("❌ 프린터 초기화에 실패했습니다.")
      return false
    }

    logDebug("🎉 프린터가 성공적으로 연결되었습니다!")
    return true
  } catch (error) {
    logDebug(`❌ 프린터 연결 중 오류 발생: ${error}`)
    console.error("[PRINTER ERROR]", error)
    return false
  }
}

/**
 * 자동 연결 함수 (이전에 연결한 포트로 재연결)
 */
export async function autoConnectPrinter(): Promise<boolean> {
  try {
    logDebug("🤖 자동 연결 시작...")

    // Web Serial API support check
    if (!("serial" in navigator)) {
      logDebug("❌ Web Serial API가 이 브라우저에서 지원되지 않습니다.")
      return false
    }

    // If already connected, reuse the connection
    if (printerPort && printerWriter) {
      logDebug("✅ 프린터가 이미 연결되어 있습니다.")
      return true
    }

    // Get list of available ports
    const ports = await (navigator as SerialNavigator).serial.getPorts()
    logDebug(`📡 사용 가능한 포트 ${ports.length}개 발견`)

    if (ports.length === 0) {
      logDebug("⚠️ 사용 가능한 포트가 없습니다. 사용자 입력이 필요합니다.")
      return await connectPrinter()
    }

    // Use the first available port
    printerPort = ports[0]
    logDebug("📌 첫 번째 사용 가능한 포트를 사용합니다.")

    // Open the port
    logDebug("🔓 포트 열기 시도 중... (115200 bps)")
    await printerPort.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    })

    // Set up the output stream
    const writableStream = printerPort.writable
    if (!writableStream) return false
    printerWriter = writableStream.getWriter()

    // Initialize printer
    await initializePrinter()

    logDebug("🎉 프린터 자동 연결 성공!")
    return true
  } catch (error) {
    logDebug("❌ 프린터 자동 연결 중 오류 발생: " + error)
    return false
  }
}

/**
 * 프린터 연결 해제 함수
 */
export async function disconnectPrinter(): Promise<void> {
  try {
    logDebug("🔌 프린터 연결 해제 시작...")

    if (printerWriter) {
      await printerWriter.close()
      printerWriter = null
      logDebug("✅ Writer 스트림을 닫았습니다.")
    }

    if (printerPort) {
      await printerPort.close()
      printerPort = null
      logDebug("✅ 포트를 닫았습니다.")
    }

    logDebug("🎉 프린터 연결이 해제되었습니다.")
  } catch (error) {
    logDebug("❌ 프린터 연결 해제 중 오류 발생: " + error)
  }
}

/**
 * 텍스트 인쇄 함수
 */
export async function printText(text: string): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("❌ 프린터가 연결되어 있지 않습니다.")
      return false
    }

    if (!printerPort || !printerPort.writable) {
      logDebug("❌ 프린터 포트가 더 이상 쓰기 가능하지 않습니다!")
      return false
    }

    const encoded = new TextEncoder().encode(text)
    logCommand("TEXT", encoded)
    await printerWriter.write(encoded)

    await new Promise((resolve) => setTimeout(resolve, 10))
    logDebug(`✅ ${encoded.length} 바이트 전송 완료`)

    return true
  } catch (error) {
    logDebug(`❌ 텍스트 인쇄 중 오류 발생: ${error}`)
    console.error("[PRINTER WRITE ERROR]", error)
    return false
  }
}

/**
 * 초기화 명령 전송 (표준 ESC/POS만 사용)
 */
export async function initializePrinter(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("❌ 프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("🔧 표준 프린터 초기화 명령 전송...")

    // ESC @ - 프린터 초기화 (모든 프린터 공통)
    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    // 영어 코드페이지 설정 (PC437 - 기본 영어)
    const codePageCommand = new Uint8Array([ESC, 0x74, 0])
    logCommand("ESC t (Codepage)", codePageCommand)
    await printerWriter.write(codePageCommand)

    logDebug("✅ 프린터 초기화 완료")
    return true
  } catch (error) {
    logDebug("❌ 프린터 초기화 중 오류 발생: " + error)
    return false
  }
}

/**
 * 날짜 형식 변환 함수 (YYYY-MM-DD -> YYYY.MM.DD)
 */
function formatDateForReceipt(dateString: string): string {
  if (!dateString) return "N/A"
  if (dateString.includes(".")) return dateString
  return dateString.replace(/-/g, ".")
}

/**
 * 영수증 인쇄 함수
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter || !printerPort) {
      logDebug("❌ 프린터가 연결되어 있지 않습니다. 자동 연결을 시도합니다...")
      const connected = await autoConnectPrinter()
      if (!connected) {
        logDebug("❌ 프린터 자동 연결에 실패했습니다.")
        return false
      }
    }

    if (!printerPort?.writable) {
      logDebug("❌ 프린터 포트가 쓰기 불가능 상태입니다!")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(`📄 영수증 인쇄 시작 (${useSimpleMode ? "Simple Mode" : "Rich Mode"})`)
    logDebug(`🔌 포트 상태: readable=${!!printerPort.readable}, writable=${!!printerPort.writable}`)

    if (useSimpleMode) {
      return printSimpleReceipt(receiptData)
    } else {
      return printFormattedReceipt(receiptData)
    }
  } catch (error) {
    logDebug(`❌ 영수증 인쇄 중 오류 발생: ${error}`)
    console.error("[PRINTER RECEIPT ERROR]", error)
    return false
  }
}

/**
 * Rich Mode 영수증 인쇄
 */
async function printFormattedReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("🖨️ Rich Mode 영수증 인쇄 시작")

    await initializePrinter()

    // 중간 크기 글씨 (The Beach Stay)
    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size)", midSizeCommand)
    await printerWriter.write(midSizeCommand)
    await printText("The Beach Stay\n")

    await printText("-------------------------------------\n")

    // 큰 글씨 (건물)
    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    const buildingChar =
      receiptData.roomNumber && receiptData.roomNumber.length > 0 ? receiptData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\n\n`)

    // 더 큰 글씨 (층수/객실)
    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x31])
    logCommand("ESC ! (Extra Large)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"
    const roomNumber = receiptData.roomNumber || "0000"
    await printText(`${floor} ${roomNumber}\n\n`)

    // 큰 글씨 (비밀번호)
    await printerWriter.write(largeSizeCommand)
    await printText(`Door PW: ${receiptData.password || "0000"}\n\n`)

    // 기본 크기
    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("------------------------------------\n\n")

    // 작은 글씨 (체크인/아웃)
    const smallSizeCommand = new Uint8Array([ESC, 0x21, 0x01])
    logCommand("ESC ! (Small Size)", smallSizeCommand)
    await printerWriter.write(smallSizeCommand)

    await printText(`Check-in: ${formatDateForReceipt(receiptData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(receiptData.checkOutDate)}\n\n\n`)

    // 용지 절단
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("✅ Rich Mode 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("❌ 영수증 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * Simple Mode 영수증 인쇄
 */
async function printSimpleReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("🖨️ Simple Mode 영수증 인쇄 시작")

    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    await printText("THE BEACH STAY\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")

    const buildingChar =
      receiptData.roomNumber && receiptData.roomNumber.length > 0 ? receiptData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\r\n\r\n`)

    const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"
    const roomNumber = receiptData.roomNumber || "0000"
    await printText(`ROOM: ${floor} ${roomNumber}\r\n\r\n`)
    await printText(`DOOR PASSWORD: ${receiptData.password || "0000"}\r\n\r\n`)
    await printText("-------------------------------------\r\n\r\n")
    await printText(`Check-in: ${formatDateForReceipt(receiptData.checkInDate)}\r\n`)
    await printText(`Check-out: ${formatDateForReceipt(receiptData.checkOutDate)}\r\n\r\n\r\n`)

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("✅ Simple Mode 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("❌ Simple Mode 영수증 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * 객실 정보 영수증 인쇄
 */
export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("❌ 프린터가 연결되어 있지 않습니다.")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(`📄 객실 정보 영수증 인쇄 시작 (${useSimpleMode ? "Simple Mode" : "Rich Mode"})`)

    if (useSimpleMode) {
      return printSimpleRoomInfoReceipt(roomData)
    } else {
      return printFormattedRoomInfoReceipt(roomData)
    }
  } catch (error) {
    logDebug("❌ 객실 정보 영수증 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * Rich Mode 객실 정보 영수증
 */
async function printFormattedRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("🖨️ Rich Mode 객실 정보 영수증 인쇄 시작")

    await initializePrinter()

    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size)", midSizeCommand)
    await printerWriter.write(midSizeCommand)
    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    const buildingChar = roomData.roomNumber && roomData.roomNumber.length > 0 ? roomData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\n\n`)

    const floor = roomData.floor ? `${roomData.floor}F` : "2F"
    const roomNumber = roomData.roomNumber || "000"
    await printText(`${roomNumber} ${floor}\n\n`)
    await printText(`Door PW: ${roomData.password || "0000"}\n\n`)

    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)
    await printText("------------------------------------\n\n\n")

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("✅ Rich Mode 객실 정보 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("❌ 객실 정보 영수증 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * Simple Mode 객실 정보 영수증
 */
async function printSimpleRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("🖨️ Simple Mode 객실 정보 영수증 인쇄 시작")

    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    await printText("THE BEACH STAY\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")

    const buildingChar = roomData.roomNumber && roomData.roomNumber.length > 0 ? roomData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\r\n\r\n`)

    const floor = roomData.floor ? `${roomData.floor}F` : "2F"
    const roomNumber = roomData.roomNumber || "000"
    await printText(`ROOM: ${roomNumber} ${floor}\r\n\r\n`)
    await printText(`DOOR PASSWORD: ${roomData.password || "0000"}\r\n\r\n\r\n`)

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("✅ Simple Mode 객실 정보 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("❌ Simple Mode 객실 정보 영수증 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * 프린터 상태 확인 함수
 */
export function isPrinterConnected(): boolean {
  const isConnected = printerPort !== null && printerWriter !== null
  logDebug(`🔍 연결 상태 확인: ${isConnected ? "✅ 연결됨" : "❌ 연결 안됨"}`)
  return isConnected
}

/**
 * 테스트 페이지 인쇄
 */
export async function printTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("❌ 프린터가 연결되어 있지 않습니다.")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(`📄 테스트 페이지 인쇄 시작 (${useSimpleMode ? "Simple Mode" : "Rich Mode"})`)

    if (useSimpleMode) {
      return printSimpleTestPage()
    } else {
      return printFormattedTestPage()
    }
  } catch (error) {
    logDebug("❌ 테스트 페이지 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * Rich Mode 테스트 페이지
 */
async function printFormattedTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("🖨️ Rich Mode 테스트 페이지 인쇄 시작")

    await initializePrinter()

    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size)", midSizeCommand)
    await printerWriter.write(midSizeCommand)
    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)
    await printText("D BUILDING\n\n")

    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x31])
    logCommand("ESC ! (Extra Large)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)
    await printText("2F D213\n\n")

    await printerWriter.write(largeSizeCommand)
    await printText("Door PW: 2133\n\n")

    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)
    await printText("------------------------------------\n\n")

    const smallSizeCommand = new Uint8Array([ESC, 0x21, 0x01])
    logCommand("ESC ! (Small Size)", smallSizeCommand)
    await printerWriter.write(smallSizeCommand)
    await printText("Check-in: 2025.04.05\n")
    await printText("Check-out: 2025.04.06\n\n\n")

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("✅ Rich Mode 테스트 페이지 인쇄 완료")
    return true
  } catch (error) {
    logDebug("❌ 테스트 페이지 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * Simple Mode 테스트 페이지
 */
async function printSimpleTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("🖨️ Simple Mode 테스트 페이지 인쇄 시작")

    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    await printText("THE BEACH STAY\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")
    await printText("PRINTER TEST - SIMPLE MODE\r\n\r\n")
    await printText("D BUILDING\r\n\r\n")
    await printText("ROOM: D213 2F\r\n\r\n")
    await printText("DOOR PASSWORD: 2133\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")
    await printText("Check-in: 2025.04.05\r\n")
    await printText("Check-out: 2025.04.06\r\n\r\n\r\n")

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("✅ Simple Mode 테스트 페이지 인쇄 완료")
    return true
  } catch (error) {
    logDebug("❌ Simple Mode 테스트 페이지 인쇄 중 오류: " + error)
    return false
  }
}

/**
 * 프린터 상태 정보 가져오기
 */
export function getPrinterStatus(): {
  connected: boolean
  model: string
  simpleMode: boolean
  lastCommand?: { command: string; bytes: number[]; timestamp: string }
} {
  const status = {
    connected: isPrinterConnected(),
    model: "STANDARD",
    simpleMode: getSimplePrintMode(),
    lastCommand: commandLog.length > 0 ? commandLog[commandLog.length - 1] : undefined,
  }

  logDebug("📊 프린터 상태 조회:")
  logDebug(`  - 연결: ${status.connected ? "✅" : "❌"}`)
  logDebug(`  - 모델: ${status.model}`)
  logDebug(`  - Simple Mode: ${status.simpleMode ? "활성화" : "비활성화"}`)

  return status
}

/**
 * 프린터 진단 정보 가져오기
 */
export function getPrinterDiagnostics(): any {
  const diagnostics = {
    connected: isPrinterConnected(),
    model: "STANDARD",
    simpleMode: getSimplePrintMode(),
    environmentVariables: {
      PRINTER_SIMPLE_MODE: process.env.PRINTER_SIMPLE_MODE || "not set",
      NEXT_PUBLIC_FORCE_SIMPLE_MODE: process.env.NEXT_PUBLIC_FORCE_SIMPLE_MODE || "not set",
    },
    commandLog: commandLog.slice(-10),
  }

  logDebug("🔬 프린터 진단 정보 생성")
  logDebug(`  - 명령 로그: ${commandLog.length}개`)

  return diagnostics
}

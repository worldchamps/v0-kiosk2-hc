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
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    // ESC @ - 프린터 초기화 (모든 프린터 공통)
    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    // 영어 코드페이지 설정 (PC437 - 기본 영어)
    const codePageCommand = new Uint8Array([ESC, 0x74, 0]) // ESC t 0 - PC437 (영어)
    logCommand("ESC t (Codepage)", codePageCommand)
    await printerWriter.write(codePageCommand)

    // 프린터 모델별 추가 초기화
    if (detectedPrinterModel === "BK3-3") {
      // BK3-3 프린터 특화 초기화 명령
      // 예: 라인 간격 설정
      const lineSpacingCommand = new Uint8Array([ESC, 0x33, 30]) // 30-dot line spacing
      logCommand("ESC 3 (Line Spacing)", lineSpacingCommand)
      await printerWriter.write(lineSpacingCommand)
    } else if (detectedPrinterModel === "SAM4S") {
      // SAM4S 프린터 특화 초기화 명령
      // 예: 문자 간격 설정
      const charSpacingCommand = new Uint8Array([ESC, 0x20, 0]) // 0-dot character spacing
      logCommand("ESC SP (Char Spacing)", charSpacingCommand)
      await printerWriter.write(charSpacingCommand)
    }

    return true
  } catch (error) {
    logDebug("프린터 초기화 중 오류 발생: " + error)
    return false
  }
}

/**
 * 객실 타입을 영어로 변환하는 함수
 */
function translateRoomType(roomType: string): string {
  if (!roomType) return "Standard Room"

  const lowerType = roomType.toLowerCase()

  if (lowerType.includes("스탠다드") && lowerType.includes("더블")) {
    return "Standard Double"
  } else if (lowerType.includes("스탠다드") && lowerType.includes("트윈")) {
    return "Standard Twin"
  } else if (
    lowerType.includes("디럭스") &&
    lowerType.includes("더블") &&
    (lowerType.includes("오션") || lowerType.includes("오션뷰"))
  ) {
    return "Deluxe Double Ocean"
  } else if (lowerType.includes("디럭스") && lowerType.includes("더블")) {
    return "Deluxe Double"
  } else if (
    lowerType.includes("스위트") &&
    lowerType.includes("트윈") &&
    (lowerType.includes("오션") || lowerType.includes("오션뷰"))
  ) {
    return "Suite Twin Ocean"
  } else if (lowerType.includes("스위트") && lowerType.includes("트윈")) {
    return "Suite Twin"
  } else if (lowerType.includes("스위트")) {
    return "Suite Room"
  } else if (lowerType.includes("디럭스")) {
    return "Deluxe Room"
  } else if (lowerType.includes("스탠다드")) {
    return "Standard Room"
  }

  return "Standard Room"
}

/**
 * 날짜 형식 변환 함수 (YYYY-MM-DD -> YYYY.MM.DD)
 */
function formatDateForReceipt(dateString: string): string {
  if (!dateString) return "N/A"

  // 이미 YYYY.MM.DD 형식이면 그대로 반환
  if (dateString.includes(".")) return dateString

  // YYYY-MM-DD 형식을 YYYY.MM.DD로 변환
  return dateString.replace(/-/g, ".")
}

/**
 * 영수증 인쇄 함수 - 모드에 따라 다른 형식 사용
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    // Check if simple mode is enabled - 프린터 모델 고려
    const useSimpleMode = getSimplePrintMode()
    logDebug(`영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`)

    if (useSimpleMode) {
      return printSimpleReceipt(receiptData)
    } else {
      // BK3-3 프린터가 Rich Mode를 제대로 처리하지 못하는 경우를 위한 안전장치
      if (detectedPrinterModel === "BK3-3" && process.env.FORCE_SIMPLE_FOR_BK3 === "true") {
        logDebug("BK3-3 프린터에 대해 강제로 Simple Mode 사용")
        return printSimpleReceipt(receiptData)
      }
      return printFormattedReceipt(receiptData)
    }
  } catch (error) {
    logDebug("영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 기존 형식의 영수증 인쇄 함수 - 명령어 로깅 추가
 */
async function printFormattedReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Rich Mode로 영수증 인쇄 시작")

    // 프린터 초기화
    await initializePrinter()

    // 중간 크기 글씨로 설정 (The Beach Stay)
    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10]) // 중간 크기 글씨
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")

    // 구분선
    await printText("-------------------------------------\n")

    // 건물 이름 - 큰 글씨로 표시
    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30]) // 큰 글씨
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    const buildingChar =
      receiptData.roomNumber && receiptData.roomNumber.length > 0 ? receiptData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\n\n`)

    // 층수와 객실 번호 - 더 큰 글씨로 표시
    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x31]) // 더 큰 글씨
    logCommand("ESC ! (Extra Large Size Font)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"
    const roomNumber = receiptData.roomNumber || "0000"
    await printText(`${floor} ${roomNumber}\n\n`)

    // 비밀번호 - 큰 글씨로 표시
    const largeSizeCommand2 = new Uint8Array([ESC, 0x21, 0x30]) // 다시 큰 글씨로
    logCommand("ESC ! (Large Size Font)", largeSizeCommand2)
    await printerWriter.write(largeSizeCommand2)

    await printText(`Door PW: ${receiptData.password || "0000"}\n\n`)

    // 구분선
    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00]) // 기본 글씨 크기로 돌아감
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("------------------------------------\n\n")

    // 체크인/체크아웃 정보 - 작은 글씨로 표시
    const smallSizeCommand = new Uint8Array([ESC, 0x21, 0x01]) // 작은 글씨
    logCommand("ESC ! (Small Size Font)", smallSizeCommand)
    await printerWriter.write(smallSizeCommand)

    await printText(`Check-in: ${formatDateForReceipt(receiptData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(receiptData.checkOutDate)}\n\n\n`)

    // 용지 절단 (Partial cut)
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Rich Mode 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 단순 모드 영수증 인쇄 함수 - 최소한의 명령어만 사용
 */
async function printSimpleReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Simple Mode로 영수증 인쇄 시작")

    // ESC @ - Initialize printer (supported by SAM4S ELLIX/GIANT)
    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    // Use only basic text with minimal formatting
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

    // Use GS V 1 for partial cut - confirmed supported by SAM4S ELLIX/GIANT
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Simple Mode 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("단순 모드 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 객실 정보 영수증 인쇄 함수 - 객실 호수와 비밀번호만 출력
 */
export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    // Check if simple mode is enabled - 프린터 모델 고려
    const useSimpleMode = getSimplePrintMode()
    logDebug(
      `객실 정보 영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`,
    )

    if (useSimpleMode) {
      return printSimpleRoomInfoReceipt(roomData)
    } else {
      // BK3-3 프린터가 Rich Mode를 제대로 처리하지 못하는 경우를 위한 안전장치
      if (detectedPrinterModel === "BK3-3" && process.env.FORCE_SIMPLE_FOR_BK3 === "true") {
        logDebug("BK3-3 프린터에 대해 강제로 Simple Mode 사용")
        return printSimpleRoomInfoReceipt(roomData)
      }
      return printFormattedRoomInfoReceipt(roomData)
    }
  } catch (error) {
    logDebug("객실 정보 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 기존 형식의 객실 정보 영수증 인쇄 함수
 */
async function printFormattedRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Rich Mode로 객실 정보 영수증 인쇄 시작")

    // 프린터 초기화
    await initializePrinter()

    // 중간 크기 글씨로 설정 (The Beach Stay)
    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10]) // 중간 크기 글씨
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")

    // 구분선
    await printText("-------------------------------------\n")

    // 건물 이름 - 큰 글씨로 표시
    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30]) // 큰 글씨
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    const buildingChar = roomData.roomNumber && roomData.roomNumber.length > 0 ? roomData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\n\n`)

    // 층수와 객실 번호 - 더 큰 글씨로 표시
    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x30]) // 더 큰 글씨
    logCommand("ESC ! (Large Size Font)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    const floor = roomData.floor ? `${roomData.floor}F` : "2F"
    const roomNumber = roomData.roomNumber || "000"
    await printText(`${roomNumber} ${floor}`)
    await printText("\n\n")

    // 비밀번호 - 큰 글씨로 표시
    await printerWriter.write(largeSizeCommand)
    await printText(`Door PW: ${roomData.password}\n\n`)

    // 기본 크기로 날짜
    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("-------------------------------------\n")
    await printText(`Check-in: ${formatDateForReceipt(roomData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(roomData.checkOutDate)}\n\n\n`)

    // 용지 절단
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Rich Mode 객실 정보 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("객실 정보 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 단순 모드 객실 정보 영수증 인쇄 함수
 */
async function printSimpleRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Simple Mode로 객실 정보 영수증 인쇄 시작")

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
    await printText(`DOOR PASSWORD: ${roomData.password}\r\n\r\n\r\n`)

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Simple Mode 객실 정보 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("단순 모드 객실 정보 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 현장예약 영수증 인쇄 함수
 */
export async function printOnSiteReservationReceipt(reservationData: {
  reservationId: string
  guestName: string
  roomCode: string
  roomType: string
  checkInDate: string
  checkOutDate: string
  password: string
}): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(
      `현장예약 영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`,
    )

    if (useSimpleMode) {
      return printSimpleOnSiteReservationReceipt(reservationData)
    } else {
      if (detectedPrinterModel === "BK3-3" && process.env.FORCE_SIMPLE_FOR_BK3 === "true") {
        logDebug("BK3-3 프린터에 대해 강제로 Simple Mode 사용")
        return printSimpleOnSiteReservationReceipt(reservationData)
      }
      return printFormattedOnSiteReservationReceipt(reservationData)
    }
  } catch (error) {
    logDebug("현장예약 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 기존 형식의 현장예약 영수증 인쇄
 */
async function printFormattedOnSiteReservationReceipt(reservationData: {
  reservationId: string
  guestName: string
  roomCode: string
  roomType: string
  checkInDate: string
  checkOutDate: string
  password: string
}): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("Rich Mode로 현장예약 영수증 인쇄 시작")

    await initializePrinter()

    // 중간 크기 글씨
    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    // 큰 글씨
    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    await printText("ON-SITE RESERVATION\n\n")

    // 기본 크기
    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText(`Reservation ID:\n${reservationData.reservationId}\n\n`)
    await printText(`Guest: ${reservationData.guestName}\n`)
    await printText(`Room: ${reservationData.roomCode}\n`)
    await printText(`Type: ${translateRoomType(reservationData.roomType)}\n\n`)

    // 큰 글씨로 비밀번호
    await printerWriter.write(largeSizeCommand)
    await printText(`Door PW: ${reservationData.password}\n\n`)

    // 기본 크기로 날짜
    await printerWriter.write(normalSizeCommand)
    await printText("-------------------------------------\n")
    await printText(`Check-in: ${formatDateForReceipt(reservationData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(reservationData.checkOutDate)}\n\n\n`)

    // 용지 절단
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Rich Mode 현장예약 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("현장예약 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 단순 모드 현장예약 영수증 인쇄
 */
async function printSimpleOnSiteReservationReceipt(reservationData: {
  reservationId: string
  guestName: string
  roomCode: string
  roomType: string
  checkInDate: string
  checkOutDate: string
  password: string
}): Promise<boolean> {
  try {
    if (!printerWriter) return false

    logDebug("Simple Mode로 현장예약 영수증 인쇄 시작")

    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    await printText("THE BEACH STAY\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")
    await printText("ON-SITE RESERVATION\r\n\r\n")
    await printText(`Reservation ID:\r\n${reservationData.reservationId}\r\n\r\n`)
    await printText(`Guest: ${reservationData.guestName}\r\n`)
    await printText(`Room: ${reservationData.roomCode}\r\n`)
    await printText(`Type: ${translateRoomType(reservationData.roomType)}\r\n\r\n`)
    await printText(`DOOR PASSWORD: ${reservationData.password}\r\n\r\n`)
    await printText("-------------------------------------\r\n\r\n")
    await printText(`Check-in: ${formatDateForReceipt(reservationData.checkInDate)}\r\n`)
    await printText(`Check-out: ${formatDateForReceipt(reservationData.checkOutDate)}\r\n\r\n\r\n`)

    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Simple Mode 현장예약 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("단순 모드 현장예약 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 프린터 상태 확인 함수
 */
export function isPrinterConnected(): boolean {
  return printerPort !== null && printerWriter !== null
}

/**
 * 프린터 테스트 페이지 인쇄
 */
export async function printTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    // Check if simple mode is enabled - 프린터 모델 고려
    const useSimpleMode = getSimplePrintMode()
    logDebug(
      `테스트 페이지 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`,
    )

    if (useSimpleMode) {
      return printSimpleTestPage()
    } else {
      // BK3-3 프린터가 Rich Mode를 제대로 처리하지 못하는 경우를 위한 안전장치
      if (detectedPrinterModel === "BK3-3" && process.env.FORCE_SIMPLE_FOR_BK3 === "true") {
        logDebug("BK3-3 프린터에 대해 강제로 Simple Mode 사용")
        return printSimpleTestPage()
      }
      return printFormattedTestPage()
    }
  } catch (error) {
    logDebug("테스트 페이지 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 기존 형식의 테스트 페이지 인쇄
 */
async function printFormattedTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Rich Mode로 테스트 페이지 인쇄 시작")

    // 프린터 초기화
    await initializePrinter()

    // 중간 크기 글씨로 설정 (The Beach Stay)
    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10]) // 중간 크기 글씨
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")

    // 구분선
    await printText("-------------------------------------\n")

    // 건물 이름 - 큰 글씨로 표시
    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30]) // 큰 글씨
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    await printText("D BUILDING\n\n")

    // 층수와 객실 번호 - 더 큰 글씨로 표시
    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x31]) // 더 큰 글씨
    logCommand("ESC ! (Extra Large Size Font)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    await printText("2F D213\n\n")

    // 비밀번호 - 큰 글씨로 표시
    const largeSizeCommand2 = new Uint8Array([ESC, 0x21, 0x30]) // 다시 큰 글씨로
    logCommand("ESC ! (Large Size Font)", largeSizeCommand2)
    await printerWriter.write(largeSizeCommand2)

    await printText("Door PW: 2133\n\n")

    // 구분선
    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00]) // 기본 글씨 크기로 돌아감
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("------------------------------------\n\n")

    // 체크인/체크아웃 정보 - 작은 글씨로 표시
    const smallSizeCommand = new Uint8Array([ESC, 0x21, 0x01]) // 작은 글씨
    logCommand("ESC ! (Small Size Font)", smallSizeCommand)
    await printerWriter.write(smallSizeCommand)

    await printText("Check-in: 2025.04.05\n")
    await printText("Check-out: 2025.04.06\n\n\n")

    // 용지 절단
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Rich Mode 테스트 페이지 인쇄 완료")
    return true
  } catch (error) {
    logDebug("테스트 페이지 인쇄 중 오류 발생: " + error)
    return false
  }
}

/**
 * 단순 모드 테스트 페이지 인쇄
 */
async function printSimpleTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Simple Mode로 테스트 페이지 인쇄 시작")

    // ESC @ - Initialize printer
    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    // Basic text only
    await printText("THE BEACH STAY\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")
    await printText("PRINTER TEST - SIMPLE MODE\r\n\r\n")
    await printText("D BUILDING\r\n\r\n")
    await printText("ROOM: D213 2F\r\n\r\n")
    await printText("DOOR PASSWORD: 2133\r\n\r\n")
    await printText("-------------------------------------\r\n\r\n")
    await printText("Check-in: 2025.04.05\r\n")
    await printText("Check-out: 2025.04.06\r\n\r\n\r\n")

    // GS V 1 for partial cut
    const cutCommand = new Uint8Array([GS, 0x56, 0x01])
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Simple Mode 테스트 페이지 인쇄 완료")
    return true
  } catch (error) {
    logDebug("단순 모드 테스트 페이지 인쇄 중 오류 발생: " + error)
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
  return {
    connected: isPrinterConnected(),
    model: detectedPrinterModel,
    simpleMode: getSimplePrintMode(),
    lastCommand: commandLog.length > 0 ? commandLog[commandLog.length - 1] : undefined,
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

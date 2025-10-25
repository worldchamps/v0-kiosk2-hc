/**
 * 열전사 프린터 연결 및 제어를 위한 유틸리티 함수 (Electron API 사용)
 * 지원 모델: BK3-3, SAM4S ELLIX/GIANT
 *
 * @remarks
 * 이 코드는 Electron의 preload script를 통해 노출된 electronAPI 객체를 사용합니다.
 */

// --- Web Serial API 관련 타입 정의 제거 ---

// 프린터 연결 상태 (Electron API가 관리)
let electronPrinterConnected = false
let electronPrinterPort: string | null = null
let electronPrinterModel: "BK3-3" | "SAM4S" | "UNKNOWN" = "UNKNOWN"
let electronPrinterVendorId: string | null = null
let electronPrinterProductId: string | null = null

// 프린터 모델 및 모드 상태는 유지
let detectedPrinterModel: "BK3-3" | "SAM4S" | "UNKNOWN" = "UNKNOWN"
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
 * 명령어 로그 함수 (Electron API 전송 전 로깅)
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

// --- Electron API 객체 타입 정의 (예시) ---
// 실제 preload script에서 노출하는 타입과 일치해야 합니다.
declare global {
  interface Window {
    electronAPI?: {
      sendToPrinter: (commands: number[]) => Promise<{ success: boolean; error?: string }>
      connectPrinter: () => Promise<{ success: boolean; port?: string; error?: string }>
      disconnectPrinter: () => Promise<{ success: boolean; error?: string }>
      getPrinterStatus: () => Promise<{
        connected: boolean
        port?: string
        model?: string
        vendorId?: string
        productId?: string
        error?: string
      }>
      onPrinterStatus: (
        callback: (status: {
          connected: boolean
          port?: string
          model?: string
          vendorId?: string
          productId?: string
          error?: string
        }) => void,
      ) => void
      onPrinterData: (callback: (response: { data: number[]; timestamp: string }) => void) => void
      queryPrinterStatus: () => Promise<{ success: boolean; error?: string }>
      // 필요한 다른 함수들...
    }
  }
}

/**
 * 브라우저 환경 확인
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

/**
 * Electron API 존재 여부 확인
 */
function hasElectronAPI(): boolean {
  return isBrowser() && typeof window.electronAPI !== "undefined"
}

/**
 * Electron 메인 프로세스로 명령어 배열 전송
 */
async function sendCommandsToElectron(commands: number[]): Promise<boolean> {
  if (!hasElectronAPI() || !window.electronAPI?.sendToPrinter) {
    logDebug("Electron API (sendToPrinter) is not available.")
    return false
  }
  try {
    if (!electronPrinterConnected) {
      logDebug("Printer not connected, attempting to connect...")
      const connected = await connectPrinter()
      if (!connected) {
        logDebug("Failed to connect printer before sending commands")
        return false
      }
    }

    const result = await window.electronAPI.sendToPrinter(commands)
    if (!result.success) {
      logDebug("Error sending commands via Electron: " + result.error)
    }
    return result.success
  } catch (error) {
    logDebug("Exception sending commands via Electron: " + (error as Error).message)
    return false
  }
}

/**
 * 프린터 모델 감지 함수 (Electron 환경에서는 직접 감지 어려움)
 * 저장된 정보나 기본값 사용
 */
async function detectPrinterModel(): Promise<void> {
  // Electron 환경에서는 연결된 포트의 VID/PID를 직접 얻기 어렵습니다.
  // Main 프로세스에서 정보를 얻어 Renderer로 전달하거나,
  // 사용자가 설정하거나, 저장된 값을 사용해야 합니다.
  loadSavedPrinterModel() // 우선 저장된 값 로드 시도
  if (detectedPrinterModel === "UNKNOWN") {
    logDebug("Electron 환경: 프린터 모델을 자동으로 감지할 수 없습니다. 저장된 설정이나 기본값을 사용합니다.")
    // 필요하다면 기본 모델 설정 (예: BK3-3)
    // detectedPrinterModel = "BK3-3";
  }
  // 모델 정보를 localStorage에 저장하는 로직은 그대로 둡니다.
  try {
    localStorage.setItem("detectedPrinterModel", detectedPrinterModel)
  } catch (e) {
    logDebug("프린터 모델 정보를 저장하지 못했습니다: " + (e as Error).message)
  }
}

/**
 * 저장된 프린터 모델 정보 로드
 */
function loadSavedPrinterModel(): void {
  if (!isBrowser()) {
    return
  }

  try {
    const savedModel = localStorage.getItem("detectedPrinterModel") as "BK3-3" | "SAM4S" | "UNKNOWN" | null
    if (savedModel) {
      detectedPrinterModel = savedModel
      logDebug(`저장된 프린터 모델 정보를 로드했습니다: ${savedModel}`)
    }
  } catch (e) {
    logDebug("저장된 프린터 모델 정보를 로드하지 못했습니다: " + (e as Error).message)
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

  if (!isBrowser()) {
    return
  }

  // Save preference to localStorage
  try {
    localStorage.setItem("simplePrintMode", simple ? "true" : "false")
  } catch (e) {
    logDebug("Simple Mode 설정을 저장하지 못했습니다: " + (e as Error).message)
  }
}

/**
 * Simple Mode 상태 확인 함수 - 환경 변수, 프린터 모델, 저장된 설정을 모두 고려
 */
export function getSimplePrintMode(): boolean {
  // 1. 환경 변수 확인 (Electron 환경에서는 main 프로세스에서 처리 후 전달 가능)
  // 여기서는 process.env 접근 로직은 제거하거나 주석 처리합니다.
  /*
  try {
    if (typeof process !== "undefined" && process.env && process.env.PRINTER_SIMPLE_MODE === "true") {
      logDebug("환경 변수에서 Simple Mode 활성화됨");
      return true;
    }
  } catch (e) {
    logDebug("process.env 접근 중 오류: " + (e as Error).message);
  }
  */

  // 2. 프린터 모델에 따른 기본값 설정
  if (detectedPrinterModel === "SAM4S") {
    const defaultMode = true
    logDebug(`SAM4S 프린터 감지: 기본 Simple Mode=${defaultMode}`)

    if (isBrowser()) {
      try {
        const savedMode = localStorage.getItem("simplePrintMode")
        if (savedMode !== null) return savedMode === "true"
      } catch (e) {
        /* ignore */
      }
    }
    return defaultMode
  }

  // 3. 저장된 설정 확인
  if (isBrowser()) {
    try {
      const savedMode = localStorage.getItem("simplePrintMode")
      if (savedMode !== null) return savedMode === "true"
    } catch (e) {
      /* ignore */
    }
  }

  // 4. 기본값 (BK3-3는 기본적으로 Rich Mode 사용)
  logDebug(`기본값 사용 Simple Mode=${simplePrintMode}`)
  return simplePrintMode
}

/**
 * 프린터 모델 설정 함수 (수동 설정용)
 */
export function setPrinterModel(model: "BK3-3" | "SAM4S"): void {
  detectedPrinterModel = model
  logDebug(`프린터 모델을 수동으로 설정: ${model}`)

  if (!isBrowser()) {
    return
  }

  try {
    localStorage.setItem("detectedPrinterModel", model)
  } catch (e) {
    logDebug("프린터 모델 정보를 저장하지 못했습니다: " + (e as Error).message)
  }
}

// ESC/POS 명령어 상수
const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c
const LF = 0x0a
const CR = 0x0d

/**
 * 프린터 연결 함수 (Electron API 사용)
 */
export async function connectPrinter(): Promise<boolean> {
  if (!hasElectronAPI() || !window.electronAPI?.connectPrinter) {
    logDebug("Electron API (connectPrinter) is not available.")
    return false
  }
  try {
    logDebug("Requesting printer connection via Electron...")
    const result = await window.electronAPI.connectPrinter()
    electronPrinterConnected = result.success
    electronPrinterPort = result.port || null
    if (result.success) {
      logDebug(`Printer connected via Electron on port: ${result.port}`)
      loadSavedPrinterModel() // 연결 후 모델 로드
      // await initializePrinter()
    } else {
      logDebug("Failed to connect printer via Electron: " + result.error)
    }
    return result.success
  } catch (error) {
    logDebug("Exception connecting printer via Electron: " + (error as Error).message)
    electronPrinterConnected = false
    return false
  }
}

/**
 * 자동 프린터 연결 함수 (Electron API 사용)
 */
export async function autoConnectPrinter(): Promise<boolean> {
  // Electron에서는 Main 프로세스가 자동 연결 로직을 처리하는 것이 일반적입니다.
  // 여기서는 connectPrinter와 동일하게 동작하도록 합니다.
  logDebug("Attempting auto-connect via Electron (using connectPrinter)...")
  return connectPrinter()
}

/**
 * 프린터 연결 해제 함수 (Electron API 사용)
 */
export async function disconnectPrinter(): Promise<void> {
  if (!hasElectronAPI() || !window.electronAPI?.disconnectPrinter) {
    logDebug("Electron API (disconnectPrinter) is not available.")
    return
  }
  try {
    logDebug("Requesting printer disconnection via Electron...")
    const result = await window.electronAPI.disconnectPrinter()
    if (result.success) {
      logDebug("Printer disconnected via Electron.")
      electronPrinterConnected = false
      electronPrinterPort = null
    } else {
      logDebug("Failed to disconnect printer via Electron: " + result.error)
    }
  } catch (error) {
    logDebug("Exception disconnecting printer via Electron: " + (error as Error).message)
  }
}

/**
 * 텍스트 인쇄 함수 (명령어 생성 후 Electron API로 전송)
 */
export async function printText(text: string): Promise<boolean> {
  if (!electronPrinterConnected) {
    logDebug("프린터가 연결되어 있지 않습니다.")
    return false
  }
  try {
    const encoder = new TextEncoder()
    const encoded = encoder.encode(text)
    const commands = Array.from(encoded)

    logCommand("TEXT", commands) // 로깅은 여기서
    return sendCommandsToElectron(commands) // 전송은 Electron API로
  } catch (error) {
    logDebug("텍스트 인쇄 중 오류 발생: " + (error as Error).message)
    return false
  }
}

/**
 * 초기화 명령 전송 (명령어 생성 후 Electron API로 전송)
 */
export async function initializePrinter(): Promise<boolean> {
  if (!electronPrinterConnected) {
    logDebug("프린터가 연결되어 있지 않습니다.")
    return false
  }
  try {
    const commands: number[] = []

    // ESC @ - 프린터 초기화 (범용)
    commands.push(ESC, 0x40)
    logCommand("ESC @ (Initialize)", [ESC, 0x40])

    // ESC t 0 - 영어 코드페이지 설정 (범용)
    commands.push(ESC, 0x74, 0)
    logCommand("ESC t (Codepage)", [ESC, 0x74, 0])

    return sendCommandsToElectron(commands)
  } catch (error) {
    logDebug("프린터 초기화 중 오류 발생: " + (error as Error).message)
    return false
  }
}

/**
 * 객실 타입을 영어로 변환하는 함수
 */
function translateRoomType(roomType: string): string {
  // 내용은 이전과 동일하게 유지
  if (!roomType) return "Standard Room"
  const lowerType = roomType.toLowerCase()
  if (lowerType.includes("스탠다드") && lowerType.includes("더블")) return "Standard Double"
  if (lowerType.includes("스탠다드") && lowerType.includes("트윈")) return "Standard Twin"
  if (
    lowerType.includes("디럭스") &&
    lowerType.includes("더블") &&
    (lowerType.includes("오션") || lowerType.includes("오션뷰"))
  )
    return "Deluxe Double Ocean"
  if (lowerType.includes("디럭스") && lowerType.includes("더블")) return "Deluxe Double"
  if (
    lowerType.includes("스위트") &&
    lowerType.includes("트윈") &&
    (lowerType.includes("오션") || lowerType.includes("오션뷰"))
  )
    return "Suite Twin Ocean"
  if (lowerType.includes("스위트") && lowerType.includes("트윈")) return "Suite Twin"
  if (lowerType.includes("스위트")) return "Suite Room"
  if (lowerType.includes("디럭스")) return "Deluxe Room"
  if (lowerType.includes("스탠다드")) return "Standard Room"
  return "Standard Room"
}

/**
 * 날짜 형식 변환 함수 (YYYY-MM-DD -> YYYY.MM.DD)
 */
function formatDateForReceipt(dateString: string): string {
  // 내용은 이전과 동일하게 유지
  if (!dateString) return "N/A"
  if (dateString.includes(".")) return dateString
  return dateString.replace(/-/g, ".")
}

/**
 * 명령어 배열 생성 함수 (공통 로직)
 */
function buildCommands(commandsArray: (Uint8Array | number[])[]): number[] {
  const combined: number[] = []
  commandsArray.forEach((cmd) => {
    if (cmd instanceof Uint8Array) {
      combined.push(...Array.from(cmd))
    } else {
      combined.push(...cmd)
    }
  })
  return combined
}

/**
 * 영수증 인쇄 함수 - 모드에 따라 다른 형식 사용 (Electron API 사용)
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  if (!electronPrinterConnected) {
    logDebug("프린터가 연결되어 있지 않습니다.")
    return false
  }
  try {
    const useSimpleMode = getSimplePrintMode()
    logDebug(`영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`)

    let commands: number[] = []

    if (useSimpleMode) {
      commands = buildSimpleReceiptCommands(receiptData)
    } else {
      const forceSimple = false
      /*
       // Electron 환경에서는 process.env 접근 방식을 변경해야 할 수 있습니다.
       try {
         if (detectedPrinterModel === "BK3-3" && process.env.FORCE_SIMPLE_FOR_BK3 === "true") {
           forceSimple = true;
         }
       } catch (e) { }
       */
      if (forceSimple) {
        logDebug("BK3-3 프린터에 대해 강제로 Simple Mode 사용")
        commands = buildSimpleReceiptCommands(receiptData)
      } else {
        commands = buildFormattedReceiptCommands(receiptData)
      }
    }
    return sendCommandsToElectron(commands)
  } catch (error) {
    logDebug("영수증 인쇄 중 오류 발생: " + (error as Error).message)
    return false
  }
}

/**
 * Rich Mode 영수증 명령어 배열 생성 함수
 */
function buildFormattedReceiptCommands(receiptData: any): number[] {
  logDebug("Rich Mode 영수증 명령어 생성 시작")
  const encoder = new TextEncoder()
  const commands: (Uint8Array | number[])[] = []

  // 초기화 (범용)
  commands.push([ESC, 0x40]) // ESC @
  commands.push([ESC, 0x74, 0]) // ESC t 0 (Codepage PC437)

  // 중간 크기
  commands.push([ESC, 0x21, 0x10])
  commands.push(encoder.encode("The Beach Stay\n"))

  // 구분선
  commands.push(encoder.encode("-------------------------------------\n"))

  // 큰 크기 (빌딩)
  commands.push([ESC, 0x21, 0x30])
  commands.push(encoder.encode(`${receiptData.roomNumber?.charAt(0) || "A"} BUILDING\n\n`))

  // 더 큰 크기 (층/호수)
  commands.push([ESC, 0x21, 0x31])
  commands.push(
    encoder.encode(`${receiptData.floor ? `${receiptData.floor}F` : "2F"} ${receiptData.roomNumber || "0000"}\n\n`),
  )

  // 큰 크기 (비밀번호)
  commands.push([ESC, 0x21, 0x30])
  commands.push(encoder.encode(`Door PW: ${receiptData.password || "0000"}\n\n`))

  // 기본 크기 (구분선)
  commands.push([ESC, 0x21, 0x00])
  commands.push(encoder.encode("------------------------------------\n\n"))

  // 작은 크기 (체크인/아웃)
  commands.push([ESC, 0x21, 0x01])
  commands.push(encoder.encode(`Check-in: ${formatDateForReceipt(receiptData.checkInDate)}\n`))
  commands.push(encoder.encode(`Check-out: ${formatDateForReceipt(receiptData.checkOutDate)}\n\n\n`))

  // 절단 (범용 명령어)
  commands.push([GS, 0x56, 0x01]) // GS V 1 (부분 절단 - 범용)

  // 전체 명령어 로깅
  const flatCommands = buildCommands(commands)
  logCommand("Formatted Receipt Commands", flatCommands)

  return flatCommands
}

/**
 * Simple Mode 영수증 명령어 배열 생성 함수
 */
function buildSimpleReceiptCommands(receiptData: any): number[] {
  logDebug("Simple Mode 영수증 명령어 생성 시작")
  const encoder = new TextEncoder()
  const commands: (Uint8Array | number[])[] = []

  // 초기화
  commands.push([ESC, 0x40])

  // 텍스트 (CRLF 사용)
  commands.push(encoder.encode("THE BEACH STAY\r\n\r\n"))
  commands.push(encoder.encode("-------------------------------------\r\n\r\n"))
  commands.push(encoder.encode(`${receiptData.roomNumber?.charAt(0) || "A"} BUILDING\r\n\r\n`))
  const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"
  const roomNumber = receiptData.roomNumber || "0000"
  commands.push(encoder.encode(`ROOM: ${floor} ${roomNumber}\r\n\r\n`))
  commands.push(encoder.encode(`DOOR PASSWORD: ${receiptData.password || "0000"}\r\n\r\n`))
  commands.push(encoder.encode("-------------------------------------\r\n\r\n"))
  commands.push(encoder.encode(`Check-in: ${formatDateForReceipt(receiptData.checkInDate)}\r\n`))
  commands.push(encoder.encode(`Check-out: ${formatDateForReceipt(receiptData.checkOutDate)}\r\n\r\n\r\n`))

  // 절단 (SAM4S 호환)
  commands.push([GS, 0x56, 0x01]) // GS V 1

  // 전체 명령어 로깅
  const flatCommands = buildCommands(commands)
  logCommand("Simple Receipt Commands", flatCommands)

  return flatCommands
}

/**
 * 객실 정보 영수증 인쇄 함수 (Electron API 사용)
 */
export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  if (!electronPrinterConnected) {
    logDebug("프린터가 연결되어 있지 않습니다.")
    return false
  }
  try {
    const useSimpleMode = getSimplePrintMode()
    logDebug(
      `객실 정보 영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`,
    )

    let commands: number[] = []

    if (useSimpleMode) {
      commands = buildSimpleRoomInfoReceiptCommands(roomData)
    } else {
      const forceSimple = false
      /*
       try {
         if (detectedPrinterModel === "BK3-3" && process.env.FORCE_SIMPLE_FOR_BK3 === "true") {
           forceSimple = true;
         }
       } catch (e) { }
       */
      if (forceSimple) {
        logDebug("BK3-3 프린터에 대해 강제로 Simple Mode 사용")
        commands = buildSimpleRoomInfoReceiptCommands(roomData)
      } else {
        commands = buildFormattedRoomInfoReceiptCommands(roomData)
      }
    }
    return sendCommandsToElectron(commands)
  } catch (error) {
    logDebug("객실 정보 영수증 인쇄 중 오류 발생: " + (error as Error).message)
    return false
  }
}

/**
 * Rich Mode 객실 정보 영수증 명령어 배열 생성 함수
 */
function buildFormattedRoomInfoReceiptCommands(roomData: any): number[] {
  logDebug("Rich Mode 객실 정보 영수증 명령어 생성 시작")
  const encoder = new TextEncoder()
  const commands: (Uint8Array | number[])[] = []

  // 초기화 (범용)
  commands.push([ESC, 0x40])
  commands.push([ESC, 0x74, 0])

  // 중간 크기
  commands.push([ESC, 0x21, 0x10])
  commands.push(encoder.encode("The Beach Stay\n"))

  // 구분선
  commands.push(encoder.encode("-------------------------------------\n"))

  // 큰 크기 (빌딩)
  commands.push([ESC, 0x21, 0x30])
  const buildingChar = roomData.roomNumber?.charAt(0) || "A"
  commands.push(encoder.encode(`${buildingChar} BUILDING\n\n`))

  // 큰 크기 (호수/층)
  commands.push([ESC, 0x21, 0x30])
  const floor = roomData.floor ? `${roomData.floor}F` : "2F"
  const roomNumber = roomData.roomNumber || "000"
  commands.push(encoder.encode(`${roomNumber} ${floor}\n\n`))

  // 큰 크기 (비밀번호)
  commands.push([ESC, 0x21, 0x30])
  commands.push(encoder.encode(`Door PW: ${roomData.password || "0000"}\n\n`))

  // 중간 크기 (구분선)
  commands.push([ESC, 0x21, 0x10])
  commands.push(encoder.encode("------------------------------------\n\n\n"))

  // 절단 (범용 명령어)
  commands.push([GS, 0x56, 0x01]) // GS V 1

  const flatCommands = buildCommands(commands)
  logCommand("Formatted Room Info Commands", flatCommands)
  return flatCommands
}

/**
 * Simple Mode 객실 정보 영수증 명령어 배열 생성 함수
 */
function buildSimpleRoomInfoReceiptCommands(roomData: any): number[] {
  logDebug("Simple Mode 객실 정보 영수증 명령어 생성 시작")
  const encoder = new TextEncoder()
  const commands: (Uint8Array | number[])[] = []

  // 초기화
  commands.push([ESC, 0x40])

  // 텍스트 (CRLF)
  commands.push(encoder.encode("THE BEACH STAY\r\n\r\n"))
  commands.push(encoder.encode("-------------------------------------\r\n\r\n"))
  const buildingChar = roomData.roomNumber?.charAt(0) || "A"
  commands.push(encoder.encode(`${buildingChar} BUILDING\r\n\r\n`))
  const floor = roomData.floor ? `${roomData.floor}F` : "2F"
  const roomNumber = roomData.roomNumber || "000"
  commands.push(encoder.encode(`ROOM: ${roomNumber} ${floor}\r\n\r\n`)) // 순서 변경됨
  commands.push(encoder.encode(`DOOR PASSWORD: ${roomData.password || "0000"}\r\n\r\n\r\n`))

  // 절단 (SAM4S 호환)
  commands.push([GS, 0x56, 0x01]) // GS V 1

  const flatCommands = buildCommands(commands)
  logCommand("Simple Room Info Commands", flatCommands)
  return flatCommands
}

/**
 * 프린터 진단 정보 가져오기 (Electron API 사용)
 */
export async function getPrinterDiagnostics(): Promise<any> {
  const status = await window.electronAPI?.getPrinterStatus() // 최신 상태 정보 가져오기

  // Electron 환경에서는 process.env 직접 접근이 어려울 수 있으므로,
  // 해당 정보는 Main 프로세스에서 가져와야 할 수 있습니다.
  const environmentVariables = {
    PRINTER_SIMPLE_MODE: "N/A in Electron Renderer",
    FORCE_SIMPLE_FOR_BK3: "N/A in Electron Renderer",
  }

  // Connection Info는 Electron API를 통해 얻은 포트 정보 사용
  const connectionInfo = { port: status?.port }

  return {
    connected: status?.connected,
    model: status?.model,
    simpleMode: status?.simpleMode,
    environmentVariables: environmentVariables,
    connectionInfo: connectionInfo,
    commandLog: commandLog.slice(-10), // 최근 10개 명령만 반환
  }
}

/**
 * (추가) 현장 결제 영수증 인쇄 함수 (printReceipt 복제) - Electron API 사용
 */
export async function printOnSiteReservationReceipt(receiptData: any): Promise<boolean> {
  logDebug("현장 결제 영수증 인쇄 요청")
  // printReceipt 함수가 이미 모든 로직(Simple/Rich 모드, Electron 전송)을 처리하므로 재사용합니다.
  return printReceipt(receiptData)
}

// --- Electron 상태 업데이트 리스너 설정 ---
// 앱 초기화 시 한 번 호출되어야 합니다.
function setupElectronStatusListener() {
  if (!isBrowser()) {
    return
  }

  if (hasElectronAPI() && window.electronAPI?.onPrinterStatus) {
    window.electronAPI.onPrinterStatus((status) => {
      logDebug(
        `Received status update from Electron: Connected=${status.connected}, Port=${status.port}, Model=${status.model}, VID=${status.vendorId}, PID=${status.productId}`,
      )
      electronPrinterConnected = status.connected
      electronPrinterPort = status.port || null

      if (status.model === "BK3-3") {
        detectedPrinterModel = "BK3-3"
        electronPrinterModel = "BK3-3"
        logDebug("Detected BK3-3 printer via VID/PID from Electron")
      } else if (status.model) {
        electronPrinterModel = status.model as "BK3-3" | "SAM4S" | "UNKNOWN"
      }

      electronPrinterVendorId = status.vendorId || null
      electronPrinterProductId = status.productId || null

      if (status.connected && detectedPrinterModel === "UNKNOWN" && electronPrinterModel !== "UNKNOWN") {
        detectedPrinterModel = electronPrinterModel
        logDebug(`Auto-detected printer model: ${detectedPrinterModel}`)
        try {
          localStorage.setItem("detectedPrinterModel", detectedPrinterModel)
        } catch (e) {
          logDebug("Failed to save detected model: " + (e as Error).message)
        }
      }
    })
    logDebug("Electron printer status listener attached.")

    if (window.electronAPI?.getPrinterStatus) {
      window.electronAPI
        .getPrinterStatus()
        .then((status) => {
          logDebug(
            `Initial status from Electron: Connected=${status.connected}, Port=${status.port}, Model=${status.model}`,
          )
          electronPrinterConnected = status.connected
          electronPrinterPort = status.port || null

          if (status.model === "BK3-3") {
            detectedPrinterModel = "BK3-3"
            electronPrinterModel = "BK3-3"
            logDebug("Initial detection: BK3-3 printer via VID/PID")
            try {
              localStorage.setItem("detectedPrinterModel", "BK3-3")
            } catch (e) {
              /* ignore */
            }
          }

          if (status.connected) {
            loadSavedPrinterModel()
          }
        })
        .catch((e) => logDebug("Error getting initial status: " + (e as Error).message))
    }
  } else {
    logDebug("Electron API (onPrinterStatus) not available. Status updates will not be received.")
  }
}

let lastPrinterResponse: { data: number[]; timestamp: string } | null = null
let printerResponseCallbacks: Array<(data: number[]) => void> = []

/**
 * 프린터 응답 리스너 설정
 */
function setupPrinterDataListener() {
  if (!isBrowser()) {
    return
  }

  if (hasElectronAPI() && window.electronAPI?.onPrinterData) {
    window.electronAPI.onPrinterData((response) => {
      logDebug(`Received printer response: ${response.data.length} bytes at ${response.timestamp}`)
      logDebug(`Response hex: ${response.data.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")}`)

      lastPrinterResponse = response

      // 대기 중인 콜백 실행
      printerResponseCallbacks.forEach((callback) => callback(response.data))
      printerResponseCallbacks = []
    })
    logDebug("Printer data listener attached.")
  }
}

/**
 * 프린터 상태 쿼리 함수
 */
export async function queryPrinterStatus(): Promise<boolean> {
  if (!hasElectronAPI() || !window.electronAPI?.queryPrinterStatus) {
    logDebug("Electron API (queryPrinterStatus) is not available.")
    return false
  }

  try {
    logDebug("Querying printer real-time status...")
    const result = await window.electronAPI.queryPrinterStatus()

    if (result.success) {
      logDebug("Status query sent successfully. Waiting for response...")
      return true
    } else {
      logDebug("Failed to send status query: " + result.error)
      return false
    }
  } catch (error) {
    logDebug("Exception querying printer status: " + (error as Error).message)
    return false
  }
}

/**
 * 프린터 응답 대기 함수
 */
export async function waitForPrinterResponse(timeoutMs = 2000): Promise<number[] | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logDebug("Printer response timeout")
      const index = printerResponseCallbacks.indexOf(callback)
      if (index > -1) {
        printerResponseCallbacks.splice(index, 1)
      }
      resolve(null)
    }, timeoutMs)

    const callback = (data: number[]) => {
      clearTimeout(timeout)
      resolve(data)
    }

    printerResponseCallbacks.push(callback)
  })
}

if (isBrowser()) {
  setupElectronStatusListener()
  setupPrinterDataListener() // Added printer data listener setup
  loadSavedPrinterModel()

  // 기본 모델이 설정되지 않은 경우 BK3-3로 설정
  if (detectedPrinterModel === "UNKNOWN") {
    detectedPrinterModel = "BK3-3"
    logDebug("기본 프린터 모델을 BK3-3로 설정")
  }
}

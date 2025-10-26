/**
 * 열전사 프린터 연결 및 제어를 위한 유틸리티 함수 (Web Serial API 사용)
 * 지원 모델: BK3-3, SAM4S ELLIX/GIANT
 *
 * @remarks
 * 이 코드는 Electron의 preload script를 통해 노출된 electronAPI 객체를 사용합니다.
 */

// 프린터 연결 상태
let printerPort: SerialPort | null = null
let printerWriter: WritableStreamDefaultWriter | null = null
let printerReader: ReadableStreamDefaultReader | null = null
let lastConnectedPortInfo: any = null

// 프린터 모델 및 모드 상태
let detectedPrinterModel: "BK3-3" | "SAM4S" | "UNKNOWN" = "UNKNOWN"
let simplePrintMode = false

// Debug logging
const ENABLE_DEBUG_LOGGING = true

/**
 * 디버그 로그 함수
 */
function logDebug(message: string): void {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[PRINTER] ${message}`)
  }
}

/**
 * 브라우저 환경 확인
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

/**
 * 프린터 포트 열기 함수 (Web Serial API)
 */
export async function openPrinterPort(): Promise<boolean> {
  try {
    logDebug("프린터 포트 선택 시작")

    // Web Serial API 지원 확인
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API가 지원되지 않습니다. Chrome 89+ 또는 Edge 89+를 사용해주세요.")
    }

    // 포트 선택 요청
    printerPort = await (navigator as any).serial.requestPort()
    logDebug("포트가 선택됨")

    // 포트 정보 가져오기
    try {
      lastConnectedPortInfo = printerPort.getInfo ? await printerPort.getInfo() : {}
      logDebug(`포트 정보: ${JSON.stringify(lastConnectedPortInfo)}`)
    } catch (err) {
      logDebug(`포트 정보 가져오기 실패: ${err}`)
    }

    // 포트 열기
    await printerPort.open({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    })
    logDebug("포트가 성공적으로 열림")

    // 스트림 설정
    const writableStream = printerPort.writable
    const readableStream = printerPort.readable

    if (!writableStream || !readableStream) {
      throw new Error("스트림을 가져올 수 없습니다")
    }

    printerWriter = writableStream.getWriter()
    printerReader = readableStream.getReader()
    logDebug("스트림 설정 완료")

    return true
  } catch (error) {
    logDebug(`프린터 포트 열기 실패: ${error}`)
    await closePrinterPort()
    throw error
  }
}

/**
 * 프린터 포트 닫기 함수
 */
export async function closePrinterPort(): Promise<void> {
  try {
    if (printerReader) {
      await printerReader.cancel()
      printerReader = null
    }

    if (printerWriter) {
      await printerWriter.close()
      printerWriter = null
    }

    if (printerPort) {
      await printerPort.close()
      printerPort = null
    }

    logDebug("프린터 포트 닫기 완료")
  } catch (error) {
    logDebug(`프린터 포트 닫기 오류: ${error}`)
  }
}

/**
 * 프린터 연결 상태 확인
 */
export function isPrinterConnected(): boolean {
  return printerPort !== null && printerWriter !== null && printerReader !== null
}

// --- Electron API 객체 타입 정의 ---
declare global {
  interface Window {
    electronAPI?: {
      printer?: {
        listPorts: () => Promise<{ success: boolean; ports?: any[]; error?: string }>
        connect: (portPath?: string) => Promise<{ success: boolean; error?: string }>
        disconnect: () => Promise<{ success: boolean; error?: string }>
        isConnected: () => Promise<{ connected: boolean }>
        printReceipt: (receiptData: any) => Promise<{ success: boolean; error?: string }>
        printTest: () => Promise<{ success: boolean; error?: string }>
      }
      // 기존 API (하위 호환성)
      sendToPrinter?: (commands: number[]) => Promise<{ success: boolean; error?: string }>
      connectPrinter?: () => Promise<{ success: boolean; port?: string; error?: string }>
      disconnectPrinter?: () => Promise<{ success: boolean; error?: string }>
      getPrinterStatus?: () => Promise<{
        connected: boolean
        port?: string
        model?: string
        vendorId?: string
        productId?: string
        error?: string
      }>
      onPrinterStatus?: (
        callback: (status: {
          connected: boolean
          port?: string
          model?: string
          vendorId?: string
          productId?: string
          error?: string
        }) => void,
      ) => void
      onPrinterData?: (callback: (response: { data: number[]; timestamp: string }) => void) => void
      queryPrinterStatus?: () => Promise<{ success: boolean; error?: string }>
    }
  }
}

/**
 * 프린터 모델 가져오기
 */
export function getPrinterModel(): string {
  return "STANDARD" // 새로운 API에서는 항상 STANDARD 반환
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

  try {
    localStorage.setItem("simplePrintMode", simple ? "true" : "false")
  } catch (e) {
    logDebug("Simple Mode 설정을 저장하지 못했습니다: " + (e as Error).message)
  }
}

/**
 * Simple Mode 상태 확인 함수
 */
export function getSimplePrintMode(): boolean {
  if (isBrowser()) {
    try {
      const savedMode = localStorage.getItem("simplePrintMode")
      if (savedMode !== null) return savedMode === "true"
    } catch (e) {
      /* ignore */
    }
  }

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

/**
 * 사용 가능한 포트 목록 가져오기
 */
export async function listPorts(): Promise<any[]> {
  if (!isBrowser()) {
    logDebug("Web Serial API를 사용할 수 없습니다.")
    return []
  }

  try {
    const ports = await (navigator as any).serial.getPorts()
    logDebug("사용 가능한 포트 목록: " + JSON.stringify(ports))
    return ports
  } catch (error) {
    logDebug("포트 목록 가져오기 중 오류: " + (error as Error).message)
    return []
  }
}

/**
 * 프린터 연결 함수 (Web Serial API 사용)
 */
export async function connectPrinter(portPath?: string): Promise<boolean> {
  if (!isBrowser()) {
    logDebug("Web Serial API를 사용할 수 없습니다.")
    return false
  }

  try {
    if (!portPath) {
      logDebug("프린터 연결 시도...")
      return await openPrinterPort()
    }

    // 특정 포트 연결 로직 추가 (필요시)
    logDebug("특정 포트 연결 시도: " + portPath)
    return false
  } catch (error) {
    logDebug("프린터 연결 중 오류: " + (error as Error).message)
    return false
  }
}

/**
 * 자동 프린터 연결 함수
 */
export async function autoConnectPrinter(): Promise<boolean> {
  logDebug("자동 연결 시도...")
  return connectPrinter()
}

/**
 * 프린터 연결 해제 함수 (Web Serial API 사용)
 */
export async function disconnectPrinter(): Promise<void> {
  if (!isBrowser()) {
    logDebug("Web Serial API를 사용할 수 없습니다.")
    return
  }

  try {
    logDebug("프린터 연결 해제 중...")
    await closePrinterPort()
  } catch (error) {
    logDebug("프린터 연결 해제 중 오류: " + (error as Error).message)
  }
}

/**
 * 영수증 인쇄 함수 (Web Serial API 사용 - Main 프로세스에서 명령어 생성)
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  if (!isBrowser()) {
    logDebug("Web Serial API를 사용할 수 없습니다.")
    return false
  }

  if (!isPrinterConnected()) {
    logDebug("프린터가 연결되어 있지 않습니다.")
    return false
  }

  try {
    logDebug("영수증 인쇄 시작...")
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(receiptData))
    await printerWriter?.write(data)
    logDebug("영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("영수증 인쇄 중 오류: " + (error as Error).message)
    return false
  }
}

/**
 * 테스트 페이지 인쇄 함수 (Web Serial API 사용)
 */
export async function printTestPage(): Promise<boolean> {
  if (!isBrowser()) {
    logDebug("Web Serial API를 사용할 수 없습니다.")
    return false
  }

  if (!isPrinterConnected()) {
    logDebug("프린터가 연결되어 있지 않습니다.")
    return false
  }

  try {
    logDebug("테스트 페이지 인쇄 시작...")
    const testCommands = [0x1b, 0x40] // ESC @ 명령어 (초기화)
    const encoder = new TextEncoder()
    const data = encoder.encode(testCommands)
    await printerWriter?.write(data)
    logDebug("테스트 페이지 인쇄 완료")
    return true
  } catch (error) {
    logDebug("테스트 페이지 인쇄 중 오류: " + (error as Error).message)
    return false
  }
}

/**
 * 객실 정보 영수증 인쇄 함수
 */
export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  logDebug("객실 정보 영수증 인쇄 요청")
  // printReceipt 함수를 재사용
  return printReceipt(roomData)
}

/**
 * 현장 결제 영수증 인쇄 함수
 */
export async function printOnSiteReservationReceipt(receiptData: any): Promise<boolean> {
  logDebug("현장 결제 영수증 인쇄 요청")
  return printReceipt(receiptData)
}

/**
 * 프린터 상태 확인 함수 (UI용)
 */
export async function checkPrinterStatus(): Promise<{
  success: boolean
  online: boolean
  paperOk: boolean
  error: boolean
  message: string
}> {
  const connected = isPrinterConnected()

  if (!connected) {
    return {
      success: false,
      online: false,
      paperOk: false,
      error: true,
      message: "프린터가 연결되어 있지 않습니다",
    }
  }

  // Web Serial API에서는 연결 상태만 확인 가능
  return {
    success: true,
    online: true,
    paperOk: true,
    error: false,
    message: "프린터 연결됨",
  }
}

/**
 * 프린터 준비 상태 확인 함수
 */
export async function checkPrinterReady(): Promise<{
  ready: boolean
  online: boolean
  paperOut: boolean
  error: boolean
  statusByte?: number
  message: string
}> {
  const connected = isPrinterConnected()

  if (!connected) {
    return {
      ready: false,
      online: false,
      paperOut: false,
      error: true,
      message: "프린터가 연결되어 있지 않습니다",
    }
  }

  return {
    ready: true,
    online: true,
    paperOut: false,
    error: false,
    message: "프린터 준비 완료",
  }
}

/**
 * 프린터 진단 정보 가져오기
 */
export async function getPrinterDiagnostics(): Promise<any> {
  const connected = isPrinterConnected()

  return {
    connected,
    model: "STANDARD",
    simpleMode: getSimplePrintMode(),
    environmentVariables: {},
    connectionInfo: { port: lastConnectedPortInfo },
    commandLog: [],
  }
}

/**
 * 명령어 로그 가져오기 (더 이상 사용되지 않음)
 */
export function getCommandLog(): Array<{ command: string; bytes: number[]; timestamp: string }> {
  return []
}

/**
 * 명령어 로그 지우기 (더 이상 사용되지 않음)
 */
export function clearCommandLog(): void {
  // No-op
}

// 초기화
if (isBrowser()) {
  // 저장된 Simple Mode 설정 로드
  try {
    const savedMode = localStorage.getItem("simplePrintMode")
    if (savedMode !== null) {
      simplePrintMode = savedMode === "true"
      logDebug(`저장된 Simple Mode 설정 로드: ${simplePrintMode}`)
    }
  } catch (e) {
    /* ignore */
  }
}

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
const electronPrinterModel: "BK3-3" | "SAM4S" | "UNKNOWN" = "UNKNOWN"

// 프린터 모델 및 모드 상태는 유지
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
 * 새로운 Printer API 존재 여부 확인
 */
function hasNewPrinterAPI(): boolean {
  return hasElectronAPI() && typeof window.electronAPI?.printer !== "undefined"
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
  if (!hasNewPrinterAPI() || !window.electronAPI?.printer?.listPorts) {
    logDebug("새로운 Printer API (listPorts)를 사용할 수 없습니다.")
    return []
  }

  try {
    const result = await window.electronAPI.printer.listPorts()
    if (!result.success) {
      logDebug("포트 목록 가져오기 실패: " + result.error)
      return []
    }
    return result.ports || []
  } catch (error) {
    logDebug("포트 목록 가져오기 중 오류: " + (error as Error).message)
    return []
  }
}

/**
 * 프린터 연결 함수 (새로운 API 사용)
 */
export async function connectPrinter(portPath?: string): Promise<boolean> {
  if (!hasNewPrinterAPI() || !window.electronAPI?.printer?.connect) {
    logDebug("새로운 Printer API (connect)를 사용할 수 없습니다.")
    return false
  }

  try {
    logDebug(`프린터 연결 시도${portPath ? `: ${portPath}` : ""}...`)
    const result = await window.electronAPI.printer.connect(portPath)
    electronPrinterConnected = result.success

    if (result.success) {
      logDebug("프린터 연결 성공")
    } else {
      logDebug("프린터 연결 실패: " + result.error)
    }

    return result.success
  } catch (error) {
    logDebug("프린터 연결 중 오류: " + (error as Error).message)
    electronPrinterConnected = false
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
 * 프린터 연결 해제 함수 (새로운 API 사용)
 */
export async function disconnectPrinter(): Promise<void> {
  if (!hasNewPrinterAPI() || !window.electronAPI?.printer?.disconnect) {
    logDebug("새로운 Printer API (disconnect)를 사용할 수 없습니다.")
    return
  }

  try {
    logDebug("프린터 연결 해제 중...")
    const result = await window.electronAPI.printer.disconnect()

    if (result.success) {
      logDebug("프린터 연결 해제 완료")
      electronPrinterConnected = false
      electronPrinterPort = null
    } else {
      logDebug("프린터 연결 해제 실패: " + result.error)
    }
  } catch (error) {
    logDebug("프린터 연결 해제 중 오류: " + (error as Error).message)
  }
}

/**
 * 프린터 연결 상태 확인 함수 (새로운 API 사용)
 */
export async function isPrinterConnected(): Promise<boolean> {
  if (!hasNewPrinterAPI() || !window.electronAPI?.printer?.isConnected) {
    logDebug("새로운 Printer API (isConnected)를 사용할 수 없습니다.")
    return false
  }

  try {
    const result = await window.electronAPI.printer.isConnected()
    electronPrinterConnected = result.connected
    return result.connected
  } catch (error) {
    logDebug("연결 상태 확인 중 오류: " + (error as Error).message)
    return false
  }
}

/**
 * 영수증 인쇄 함수 (새로운 API 사용 - Main 프로세스에서 명령어 생성)
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  if (!hasNewPrinterAPI() || !window.electronAPI?.printer?.printReceipt) {
    logDebug("새로운 Printer API (printReceipt)를 사용할 수 없습니다.")
    return false
  }

  try {
    logDebug("영수증 인쇄 시작...")
    const result = await window.electronAPI.printer.printReceipt(receiptData)

    if (result.success) {
      logDebug("영수증 인쇄 완료")
    } else {
      logDebug("영수증 인쇄 실패: " + result.error)
    }

    return result.success
  } catch (error) {
    logDebug("영수증 인쇄 중 오류: " + (error as Error).message)
    return false
  }
}

/**
 * 테스트 페이지 인쇄 함수 (새로운 API 사용)
 */
export async function printTestPage(): Promise<boolean> {
  if (!hasNewPrinterAPI() || !window.electronAPI?.printer?.printTest) {
    logDebug("새로운 Printer API (printTest)를 사용할 수 없습니다.")
    return false
  }

  try {
    logDebug("테스트 페이지 인쇄 시작...")
    const result = await window.electronAPI.printer.printTest()

    if (result.success) {
      logDebug("테스트 페이지 인쇄 완료")
    } else {
      logDebug("테스트 페이지 인쇄 실패: " + result.error)
    }

    return result.success
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
  const connected = await isPrinterConnected()

  if (!connected) {
    return {
      success: false,
      online: false,
      paperOk: false,
      error: true,
      message: "프린터가 연결되어 있지 않습니다",
    }
  }

  // 새로운 API에서는 연결 상태만 확인 가능
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
  const connected = await isPrinterConnected()

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
  const connected = await isPrinterConnected()

  return {
    connected,
    model: "STANDARD",
    simpleMode: getSimplePrintMode(),
    environmentVariables: {},
    connectionInfo: { port: electronPrinterPort },
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

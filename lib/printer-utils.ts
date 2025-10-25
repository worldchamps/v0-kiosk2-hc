/**
 * 프린터 연결 및 제어를 위한 유틸리티 함수
 * USB 및 네트워크 프린터 지원
 */

// 프린터 연결 상태
let printerPort: SerialPort | null = null
let printerWriter: WritableStreamDefaultWriter | null = null
let printerReader: ReadableStreamDefaultReader | null = null
let lastConnectedPrinterInfo: any = null

// 프린터 모델 정보
interface PrinterModel {
  name: string
  vendorId: number
  productId: number
  commands: {
    initialize: Uint8Array
    cut: Uint8Array
    lineFeed: Uint8Array
  }
}

// 지원되는 프린터 모델들
const SUPPORTED_PRINTERS: PrinterModel[] = [
  {
    name: "BIXOLON SRP-350III",
    vendorId: 0x1504,
    productId: 0x0006,
    commands: {
      initialize: new Uint8Array([0x1b, 0x40]),
      cut: new Uint8Array([0x1d, 0x56, 0x00]),
      lineFeed: new Uint8Array([0x0a]),
    },
  },
  {
    name: "EPSON TM-T20",
    vendorId: 0x04b8,
    productId: 0x0202,
    commands: {
      initialize: new Uint8Array([0x1b, 0x40]),
      cut: new Uint8Array([0x1d, 0x56, 0x41, 0x03]),
      lineFeed: new Uint8Array([0x0a]),
    },
  },
]

// Debug logging
const ENABLE_PRINTER_DEBUG = true
const printerCommandLog: Array<{ command: string; data: Uint8Array; timestamp: string; error?: string }> = []

/**
 * 프린터 디버그 로그 함수
 */
function logPrinterDebug(message: string): void {
  if (ENABLE_PRINTER_DEBUG) {
    console.log(`[PRINTER] ${message}`)
  }
}

/**
 * 프린터 명령 로그 함수
 */
function logPrinterCommand(command: string, data: Uint8Array, error?: string): void {
  const timestamp = new Date().toISOString()
  printerCommandLog.push({ command, data, timestamp, error })

  const hexData = Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")

  if (error) {
    logPrinterDebug(`[CMD ERROR] ${command}: ${hexData} - ${error}`)
  } else {
    logPrinterDebug(`[CMD] ${command}: ${hexData}`)
  }
}

/**
 * 프린터 모델 감지 함수 (안전한 처리)
 */
export function detectPrinterModel(portInfo: any): PrinterModel | null {
  try {
    // 포트 정보가 없거나 불완전한 경우 처리
    if (!portInfo) {
      logPrinterDebug("포트 정보가 없습니다")
      return null
    }

    // vendorId와 productId 안전하게 추출
    const vendorId = portInfo.usbVendorId
    const productId = portInfo.usbProductId

    // undefined 체크 추가
    if (vendorId === undefined || productId === undefined) {
      logPrinterDebug("USB Vendor ID 또는 Product ID가 없습니다")
      return null
    }

    // 지원되는 프린터 모델 검색
    const model = SUPPORTED_PRINTERS.find((printer) => printer.vendorId === vendorId && printer.productId === productId)

    if (model) {
      logPrinterDebug(`프린터 모델 감지됨: ${model.name}`)
      return model
    } else {
      // 안전한 toString() 호출
      const vendorIdStr = vendorId ? vendorId.toString(16) : "unknown"
      const productIdStr = productId ? productId.toString(16) : "unknown"
      logPrinterDebug(`알 수 없는 프린터 모델: VID=${vendorIdStr}, PID=${productIdStr}`)
      return null
    }
  } catch (error) {
    logPrinterDebug(`프린터 모델 감지 중 오류 발생: ${error}`)
    return null
  }
}

/**
 * 프린터 연결 함수
 */
export async function connectPrinter(): Promise<boolean> {
  try {
    logPrinterDebug("프린터 연결 시도 시작")

    // Web Serial API 지원 확인
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API가 지원되지 않습니다")
    }

    // 사용자에게 포트 선택 요청
    try {
      printerPort = await (navigator as any).serial.requestPort()
      logPrinterDebug("프린터 포트가 선택됨")
    } catch (err) {
      logPrinterDebug(`사용자가 포트 선택을 취소: ${err}`)
      throw new Error("포트 선택이 취소되었습니다")
    }

    // 포트 정보 가져오기 (안전한 처리)
    try {
      lastConnectedPrinterInfo = printerPort.getInfo ? await printerPort.getInfo() : {}
      logPrinterDebug(`포트 정보: ${JSON.stringify(lastConnectedPrinterInfo)}`)
    } catch (err) {
      logPrinterDebug(`포트 정보 가져오기 실패: ${err}`)
      lastConnectedPrinterInfo = {}
    }

    // 프린터 모델 감지
    const detectedModel = detectPrinterModel(lastConnectedPrinterInfo)
    if (detectedModel) {
      logPrinterDebug(`감지된 프린터: ${detectedModel.name}`)
    }

    // 포트 열기
    await printerPort.open({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    })

    // 스트림 설정
    const writableStream = printerPort.writable
    const readableStream = printerPort.readable

    if (!writableStream) {
      throw new Error("쓰기 스트림을 가져올 수 없습니다")
    }

    printerWriter = writableStream.getWriter()
    if (readableStream) {
      printerReader = readableStream.getReader()
    }

    // 프린터 초기화
    if (detectedModel) {
      await printerWriter.write(detectedModel.commands.initialize)
      logPrinterCommand("Initialize", detectedModel.commands.initialize)
    }

    logPrinterDebug("프린터 연결 성공")
    return true
  } catch (error) {
    logPrinterDebug(`프린터 연결 실패: ${error}`)
    await disconnectPrinter()
    throw error
  }
}

/**
 * 프린터 연결 해제 함수
 */
export async function disconnectPrinter(): Promise<void> {
  try {
    logPrinterDebug("프린터 연결 해제 시작")

    if (printerReader) {
      try {
        await printerReader.cancel()
        logPrinterDebug("Reader 해제 완료")
      } catch (err) {
        logPrinterDebug(`Reader 해제 오류: ${err}`)
      }
      printerReader = null
    }

    if (printerWriter) {
      try {
        await printerWriter.close()
        logPrinterDebug("Writer 해제 완료")
      } catch (err) {
        logPrinterDebug(`Writer 해제 오류: ${err}`)
      }
      printerWriter = null
    }

    if (printerPort) {
      try {
        await printerPort.close()
        logPrinterDebug("Port 해제 완료")
      } catch (err) {
        logPrinterDebug(`Port 해제 오류: ${err}`)
      }
      printerPort = null
    }

    logPrinterDebug("프린터 연결 해제 완료")
  } catch (error) {
    logPrinterDebug(`프린터 연결 해제 중 오류: ${error}`)
  }
}

/**
 * 텍스트 출력 함수
 */
export async function printText(text: string): Promise<boolean> {
  try {
    if (!printerWriter) {
      throw new Error("프린터가 연결되지 않았습니다")
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(text)

    await printerWriter.write(data)
    logPrinterCommand("Print Text", data)

    return true
  } catch (error) {
    logPrinterCommand("Print Text", new Uint8Array(), `오류: ${error}`)
    return false
  }
}

/**
 * 용지 자르기 함수
 */
export async function cutPaper(): Promise<boolean> {
  try {
    if (!printerWriter) {
      throw new Error("프린터가 연결되지 않았습니다")
    }

    // 기본 컷 명령 (EPSON 호환)
    const cutCommand = new Uint8Array([0x1d, 0x56, 0x41, 0x03])

    await printerWriter.write(cutCommand)
    logPrinterCommand("Cut Paper", cutCommand)

    return true
  } catch (error) {
    logPrinterCommand("Cut Paper", new Uint8Array(), `오류: ${error}`)
    return false
  }
}

/**
 * 프린터 연결 상태 확인
 */
export function isPrinterConnected(): boolean {
  return printerPort !== null && printerWriter !== null
}

/**
 * 프린터 명령 로그 가져오기
 */
export function getPrinterCommandLog(): Array<{
  command: string
  data: Uint8Array
  timestamp: string
  error?: string
}> {
  return [...printerCommandLog]
}

/**
 * 프린터 명령 로그 지우기
 */
export function clearPrinterCommandLog(): void {
  printerCommandLog.length = 0
}

/**
 * 프린터 상태 정보 가져오기
 */
export function getPrinterStatus(): {
  connected: boolean
  model: string | null
  portInfo: any
} {
  const model = lastConnectedPrinterInfo ? detectPrinterModel(lastConnectedPrinterInfo) : null

  return {
    connected: isPrinterConnected(),
    model: model ? model.name : null,
    portInfo: lastConnectedPrinterInfo,
  }
}

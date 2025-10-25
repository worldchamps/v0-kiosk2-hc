/**
 * 열전사 프린터 연결 및 제어를 위한 유틸리티 함수
 * 지원 모델: BK3-3, SAM4S ELLIX/GIANT
 */

// 프린터 연결 상태
let printerPort: SerialPort | null = null
let printerWriter: WritableStreamDefaultWriter | null = null
let lastConnectedPortInfo: any = null
let detectedPrinterModel: "BK3-3" | "SAM4S" | "UNKNOWN" = "UNKNOWN"

// Print mode setting
let simplePrintMode = false

// Debug logging
const ENABLE_DEBUG_LOGGING = true
const commandLog: Array<{ command: string; bytes: number[]; timestamp: string }> = []

function logDebug(message: string): void {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[PRINTER] ${message}`)
  }
}

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

export function getCommandLog(): Array<{ command: string; bytes: number[]; timestamp: string }> {
  return [...commandLog]
}

export function clearCommandLog(): void {
  commandLog.length = 0
}

async function detectPrinterModel(): Promise<void> {
  try {
    const infoCommand = new Uint8Array([0x1d, 0x49, 0x01])

    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않아 모델을 감지할 수 없습니다.")
      return
    }

    logCommand("GS I (Printer Info)", infoCommand)
    await printerWriter.write(infoCommand)

    if (lastConnectedPortInfo) {
      const vendorId = lastConnectedPortInfo.usbVendorId
      const productId = lastConnectedPortInfo.usbProductId

      if (vendorId === 0x1504 || vendorId === 0x0483) {
        detectedPrinterModel = "SAM4S"
        logDebug("SAM4S 프린터로 감지되었습니다.")
      } else if (vendorId === 0x0416 || vendorId === 0x0483) {
        detectedPrinterModel = "BK3-3"
        logDebug("BK3-3 프린터로 감지되었습니다.")
      } else {
        detectedPrinterModel = "UNKNOWN"
        logDebug(`알 수 없는 프린터 모델: VID=${vendorId.toString(16)}, PID=${productId.toString(16)}`)
      }
    }

    try {
      localStorage.setItem("detectedPrinterModel", detectedPrinterModel)
    } catch (e) {
      logDebug("프린터 모델 정보를 저장하지 못했습니다: " + e)
    }
  } catch (error) {
    logDebug("프린터 모델 감지 중 오류 발생: " + error)
  }
}

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

export function getPrinterModel(): string {
  return detectedPrinterModel
}

export function setSimplePrintMode(simple: boolean): void {
  simplePrintMode = simple
  logDebug(`Simple Mode ${simple ? "활성화" : "비활성화"}됨`)

  try {
    localStorage.setItem("simplePrintMode", simple ? "true" : "false")
  } catch (e) {
    logDebug("Simple Mode 설정을 저장하지 못했습니다: " + e)
  }
}

export function getSimplePrintMode(): boolean {
  if (typeof process !== "undefined" && process.env && process.env.PRINTER_SIMPLE_MODE === "true") {
    logDebug("환경 변수에서 Simple Mode 활성화됨")
    return true
  }

  if (detectedPrinterModel === "SAM4S") {
    const defaultMode = true
    logDebug(`SAM4S 프린터 감지: 기본 Simple Mode=${defaultMode}`)

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

  logDebug(`기본값 사용 Simple Mode=${simplePrintMode}`)
  return simplePrintMode
}

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c
const LF = 0x0a
const CR = 0x0d

export async function connectPrinter(): Promise<boolean> {
  try {
    if (!("serial" in navigator)) {
      logDebug("Web Serial API is not supported in this browser.")
      return false
    }

    if (printerPort && printerWriter) {
      logDebug("Printer is already connected.")
      return true
    }

    loadSavedPrinterModel()

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

    if (storedPortInfo) {
      try {
        logDebug("Attempting to reconnect to previously used printer...")
        const ports = await (navigator as any).serial.getPorts()

        for (const port of ports) {
          const info = port.getInfo ? await port.getInfo() : {}

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

    if (!printerPort) {
      try {
        logDebug("Requesting user to select a printer port...")
        printerPort = await (navigator as any).serial.requestPort()
      } catch (err) {
        if (err.name === "NotFoundError") {
          logDebug("User cancelled port selection")
        } else {
          logDebug("Port selection error: " + err)
        }
        return false
      }
    }

    await printerPort.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "hardware",
    })

    const writableStream = printerPort.writable
    printerWriter = writableStream.getWriter()

    lastConnectedPortInfo = printerPort.getInfo ? await printerPort.getInfo() : { usbVendorId: 0, usbProductId: 0 }

    try {
      localStorage.setItem("lastPrinterPortInfo", JSON.stringify(lastConnectedPortInfo))
      logDebug("Saved printer port info to localStorage: " + JSON.stringify(lastConnectedPortInfo))
    } catch (e) {
      logDebug("Failed to save port info to localStorage: " + e)
    }

    await initializePrinter()
    await detectPrinterModel()

    logDebug("Printer connected successfully.")
    return true
  } catch (error) {
    logDebug("Error connecting to printer: " + error)
    return false
  }
}

export async function autoConnectPrinter(): Promise<boolean> {
  try {
    if (!("serial" in navigator)) {
      logDebug("Web Serial API is not supported in this browser.")
      return false
    }

    if (printerPort && printerWriter) {
      logDebug("Printer is already connected.")
      return true
    }

    loadSavedPrinterModel()

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

    const ports = await (navigator as any).serial.getPorts()

    if (ports.length === 0) {
      logDebug("No available ports for auto-connect. Skipping printer connection.")
      return false
    }

    if (storedPortInfo) {
      for (const port of ports) {
        const info = port.getInfo ? await port.getInfo() : {}

        if (info.usbVendorId === storedPortInfo.usbVendorId && info.usbProductId === storedPortInfo.usbProductId) {
          printerPort = port
          logDebug("Auto-reconnected to previously used printer!")
          break
        }
      }
    }

    if (!printerPort) {
      printerPort = ports[0]
      logDebug("Using first available port for auto-connect.")
    }

    await printerPort.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "hardware",
    })

    const writableStream = printerPort.writable
    printerWriter = writableStream.getWriter()

    lastConnectedPortInfo = printerPort.getInfo ? await printerPort.getInfo() : { usbVendorId: 0, usbProductId: 0 }

    try {
      localStorage.setItem("lastPrinterPortInfo", JSON.stringify(lastConnectedPortInfo))
    } catch (e) {
      logDebug("Failed to save port info to localStorage: " + e)
    }

    await initializePrinter()
    await detectPrinterModel()

    logDebug("Printer auto-connected successfully.")
    return true
  } catch (error) {
    logDebug("Error auto-connecting to printer: " + error)
    return false
  }
}

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

export async function printText(text: string): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    const encoded = new TextEncoder().encode(text)
    logCommand("TEXT", encoded)
    await printerWriter.write(encoded)

    return true
  } catch (error) {
    logDebug("텍스트 인쇄 중 오류 발생: " + error)
    return false
  }
}

export async function initializePrinter(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    const initCommand = new Uint8Array([ESC, 0x40])
    logCommand("ESC @ (Initialize)", initCommand)
    await printerWriter.write(initCommand)

    const codePageCommand = new Uint8Array([ESC, 0x74, 0])
    logCommand("ESC t (Codepage)", codePageCommand)
    await printerWriter.write(codePageCommand)

    if (detectedPrinterModel === "BK3-3") {
      const lineSpacingCommand = new Uint8Array([ESC, 0x33, 30])
      logCommand("ESC 3 (Line Spacing)", lineSpacingCommand)
      await printerWriter.write(lineSpacingCommand)
    } else if (detectedPrinterModel === "SAM4S") {
      const charSpacingCommand = new Uint8Array([ESC, 0x20, 0])
      logCommand("ESC SP (Char Spacing)", charSpacingCommand)
      await printerWriter.write(charSpacingCommand)
    }

    return true
  } catch (error) {
    logDebug("프린터 초기화 중 오류 발생: " + error)
    return false
  }
}

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

function formatDateForReceipt(dateString: string): string {
  if (!dateString) return "N/A"
  if (dateString.includes(".")) return dateString
  return dateString.replace(/-/g, ".")
}

export async function printReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(`영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`)

    if (useSimpleMode) {
      return printSimpleReceipt(receiptData)
    } else {
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

async function printFormattedReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Rich Mode로 영수증 인쇄 시작")

    await initializePrinter()

    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    const buildingChar =
      receiptData.roomNumber && receiptData.roomNumber.length > 0 ? receiptData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\n\n`)

    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x31])
    logCommand("ESC ! (Extra Large Size Font)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"
    const roomNumber = receiptData.roomNumber || "0000"
    await printText(`${floor} ${roomNumber}\n\n`)

    const largeSizeCommand2 = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", largeSizeCommand2)
    await printerWriter.write(largeSizeCommand2)

    await printText(`Door PW: ${receiptData.password || "0000"}\n\n`)

    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("------------------------------------\n\n")

    const smallSizeCommand = new Uint8Array([ESC, 0x21, 0x01])
    logCommand("ESC ! (Small Size Font)", smallSizeCommand)
    await printerWriter.write(smallSizeCommand)

    await printText(`Check-in: ${formatDateForReceipt(receiptData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(receiptData.checkOutDate)}\n\n\n`)

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

async function printSimpleReceipt(receiptData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Simple Mode로 영수증 인쇄 시작")

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
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Simple Mode 영수증 인쇄 완료")
    return true
  } catch (error) {
    logDebug("단순 모드 영수증 인쇄 중 오류 발생: " + error)
    return false
  }
}

export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(
      `객실 정보 영수증 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`,
    )

    if (useSimpleMode) {
      return printSimpleRoomInfoReceipt(roomData)
    } else {
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

async function printFormattedRoomInfoReceipt(roomData: any): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Rich Mode로 객실 정보 영수증 인쇄 시작")

    await initializePrinter()

    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    const buildingChar = roomData.roomNumber && roomData.roomNumber.length > 0 ? roomData.roomNumber.charAt(0) : "A"
    await printText(`${buildingChar} BUILDING\n\n`)

    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    const floor = roomData.floor ? `${roomData.floor}F` : "2F"
    const roomNumber = roomData.roomNumber || "000"
    await printText(`${roomNumber} ${floor}`)
    await printText("\n\n")

    await printerWriter.write(largeSizeCommand)
    await printText(`Door PW: ${roomData.password}\n\n`)

    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("-------------------------------------\n")
    await printText(`Check-in: ${formatDateForReceipt(roomData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(roomData.checkOutDate)}\n\n\n`)

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

    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    await printText("ON-SITE RESERVATION\n\n")

    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText(`Reservation ID:\n${reservationData.reservationId}\n\n`)
    await printText(`Guest: ${reservationData.guestName}\n`)
    await printText(`Room: ${reservationData.roomCode}\n`)
    await printText(`Type: ${translateRoomType(reservationData.roomType)}\n\n`)

    await printerWriter.write(normalSizeCommand)
    await printText(`Door PW: ${reservationData.password}\n\n`)

    await printerWriter.write(normalSizeCommand)
    await printText("-------------------------------------\n")
    await printText(`Check-in: ${formatDateForReceipt(reservationData.checkInDate)}\n`)
    await printText(`Check-out: ${formatDateForReceipt(reservationData.checkOutDate)}\n\n\n`)

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
    await printText("-------------------------------------\r\n\r\n" )
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

export function isPrinterConnected(): boolean {
  return printerPort !== null && printerWriter !== null
}

export async function printTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    const useSimpleMode = getSimplePrintMode()
    logDebug(
      `테스트 페이지 인쇄 모드: ${useSimpleMode ? "Simple Mode" : "Rich Mode"}, 프린터 모델: ${detectedPrinterModel}`,
    )

    if (useSimpleMode) {
      return printSimpleTestPage()
    } else {
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

async function printFormattedTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      \
      return false
    }

    logDebug("Rich Mode로 테스트 페이지 인쇄 시작")
    \
    await initializePrinter()
\
    const midSizeCommand = new Uint8Array([ESC, 0x21, 0x10])
    logCommand("ESC ! (Mid Size Font)", midSizeCommand)
    \
    await printerWriter.write(midSizeCommand)

    await printText("The Beach Stay\n")
    await printText("-------------------------------------\n")

    const largeSizeCommand = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", largeSizeCommand)
    await printerWriter.write(largeSizeCommand)

    await printText("D BUILDING\n\n")

    const extraLargeSizeCommand = new Uint8Array([ESC, 0x21, 0x31])
    logCommand("ESC ! (Extra Large Size Font)", extraLargeSizeCommand)
    await printerWriter.write(extraLargeSizeCommand)

    await printText("2F D213\n\n")

    const largeSizeCommand2 = new Uint8Array([ESC, 0x21, 0x30])
    logCommand("ESC ! (Large Size Font)", largeSizeCommand2)
    await printerWriter.write(largeSizeCommand2)

    await printText("Door PW: 2133\n\n")

    const normalSizeCommand = new Uint8Array([ESC, 0x21, 0x00])
    logCommand("ESC ! (Normal Size Font)", normalSizeCommand)
    await printerWriter.write(normalSizeCommand)

    await printText("------------------------------------\n\n")

    const smallSizeCommand = new Uint8Array([ESC, 0x21, 0x01])
    logCommand("ESC ! (Small Size Font)", smallSizeCommand)
    await printerWriter.write(smallSizeCommand)

    await printText("Check-in: 2025.04.05\n")
    await printText("Check-out: 2025.04.06\n\n\n")

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

async function printSimpleTestPage(): Promise<boolean> {
  try {
    if (!printerWriter) {
      logDebug("프린터가 연결되어 있지 않습니다.")
      return false
    }

    logDebug("Simple Mode로 테스트 페이지 인쇄 시작")

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
    logCommand("GS V (Cut Paper)", cutCommand)
    await printerWriter.write(cutCommand)

    logDebug("Simple Mode 테스트 페이지 인쇄 완료")
    return true
  } catch (error) {
    logDebug("단순 모드 테스트 페이지 인쇄 중 오류 발생: " + error)
    return false
  }
}

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
    commandLog: commandLog.slice(-10),
  }
}

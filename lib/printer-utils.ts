/**
 * Bixolon 프린터 제어 유틸리티 (Hardware Server 연동)
 */

declare global {
  interface Window {
    electronAPI: any
  }
}

// --------------------------------------------------------
// ESC/POS Commands
// --------------------------------------------------------
const CMD = {
  INIT: [0x1b, 0x40], // ESC @ - Initialize (ASCII Mode)
  CUT: [0x1d, 0x56, 0x42, 0x00], // GS V B 0 (Feed & Cut)
  LF: [0x0a], // Line Feed
  ALIGN_LEFT: [0x1b, 0x61, 0x00],
  ALIGN_CENTER: [0x1b, 0x61, 0x01],
  ALIGN_RIGHT: [0x1b, 0x61, 0x02],
  BOLD_ON: [0x1b, 0x45, 0x01],
  BOLD_OFF: [0x1b, 0x45, 0x00],
  FONT_A: [0x1b, 0x4d, 0x00],
  FONT_B: [0x1b, 0x4d, 0x01],
  SIZE_NORMAL: [0x1d, 0x21, 0x00],
  SIZE_2X: [0x1d, 0x21, 0x11],
  SIZE_DOUBLE_HEIGHT: [0x1d, 0x21, 0x01],
  SIZE_DOUBLE_WIDTH: [0x1d, 0x21, 0x10],
}

// --------------------------------------------------------
// Helper Functions
// --------------------------------------------------------

async function sendRaw(data: number[]) {
  return await window.electronAPI.sendRawToBixolon(data)
}

type PrintTextOptions = {
  alignment?: number
  attribute?: number
  textSize?: number
  codePage?: number
}

const STYLE = {
  ALIGN_LEFT: 0,
  ALIGN_CENTER: 1,
  FONT_DEFAULT: 0,
  FONT_BOLD: 2,
  FONT_UNDERLINE: 4,
  SIZE_NORMAL: 0,
  SIZE_DOUBLE_HEIGHT: 0x01,
  SIZE_DOUBLE: 0x11,
  KS5601: 949,
}

export async function printText(text: string, options: PrintTextOptions = {}) {
  return await window.electronAPI.printToBixolon(text, {
    alignment: options.alignment ?? STYLE.ALIGN_LEFT,
    attribute: options.attribute ?? STYLE.FONT_DEFAULT,
    textSize: options.textSize ?? STYLE.SIZE_NORMAL,
    codePage: options.codePage ?? STYLE.KS5601,
  })
}

export async function cutPaper() {
  return await window.electronAPI.cutBixolonPaper()
}

export async function initializePrinter() {
  await sendRaw(CMD.INIT)
}

// --------------------------------------------------------
// High-Level Receipt Printing
// --------------------------------------------------------

export interface CardPaymentReceiptData {
  provider: "TOSS_FRONT"
  amount: number
  tax: number
  supplyValue: number
  approvalNumber: string
  timestamp: number
  installment: number
  issuerName?: string
  maskedCardNumber?: string
  tid?: string
}

export interface ReceiptBusinessInfo {
  name: string
  registrationNumber?: string
  representative?: string
  address?: string
  phone?: string
}

export interface KioskReceiptData {
  hotelName: string
  roomNumber: string
  password?: string
  checkInDate?: string
  checkOutDate?: string
  reservationId?: string
  paymentReceipt?: CardPaymentReceiptData | null
  business?: ReceiptBusinessInfo
}

export async function printReceipt(data: KioskReceiptData): Promise<boolean> {
  console.log("[Bixolon] Printing receipt...", data)

  const password = data.password
    ? `${data.password.replace(/\*+$/, "")}*`
    : ""
  const roomNumber = formatRoomNumber(data.roomNumber)
  const checkInDate = formatReceiptDate(data.checkInDate)
  const checkOutDate = formatReceiptDate(data.checkOutDate)

  await sendRaw(CMD.INIT)

  await printText(`${data.hotelName}\n`, {
    alignment: STYLE.ALIGN_CENTER,
    attribute: STYLE.FONT_BOLD,
    textSize: STYLE.SIZE_DOUBLE,
  })

  if (data.paymentReceipt) {
    const payment = data.paymentReceipt
    const business = data.business

    await printText("카드 결제 영수증\n\n", {
      alignment: STYLE.ALIGN_CENTER,
      attribute: STYLE.FONT_BOLD,
      textSize: STYLE.SIZE_DOUBLE_HEIGHT,
    })

    if (business?.name) await printText(`상호        ${business.name}\n`)
    if (business?.registrationNumber) await printText(`사업자번호  ${business.registrationNumber}\n`)
    if (business?.representative) await printText(`대표자      ${business.representative}\n`)
    if (business?.address) await printText(`주소        ${business.address}\n`)
    if (business?.phone) await printText(`전화        ${business.phone}\n`)

    await printSeparator()
    await printText(`승인일시    ${formatPaymentDate(payment.timestamp)}\n`)
    await printText(`승인번호    ${payment.approvalNumber}\n`)
    if (payment.issuerName) await printText(`카드사      ${payment.issuerName}\n`)
    if (payment.maskedCardNumber) await printText(`카드번호    ${payment.maskedCardNumber}\n`)
    await printText(`할부        ${payment.installment > 0 ? `${payment.installment}개월` : "일시불"}\n`)
    if (data.reservationId) await printText(`예약번호    ${data.reservationId}\n`)

    await printSeparator()
    await printText(`공급가액    ${formatReceiptAmount(payment.supplyValue)}\n`)
    await printText(`부가세      ${formatReceiptAmount(payment.tax)}\n`)
    await printText("결제금액\n", {
      alignment: STYLE.ALIGN_CENTER,
      attribute: STYLE.FONT_BOLD,
    })
    await printText(`${formatReceiptAmount(payment.amount)}\n\n`, {
      alignment: STYLE.ALIGN_CENTER,
      attribute: STYLE.FONT_BOLD,
      textSize: STYLE.SIZE_DOUBLE,
    })
    await printText("카드 승인 완료\n\n", {
      alignment: STYLE.ALIGN_CENTER,
      attribute: STYLE.FONT_BOLD,
    })
    await printSeparator()
  }

  await printText("입실 안내\n\n", {
    alignment: STYLE.ALIGN_CENTER,
    attribute: STYLE.FONT_BOLD,
    textSize: STYLE.SIZE_DOUBLE_HEIGHT,
  })
  await printText("아래 비밀번호를 도어락에 입력하세요.\n\n", {
    alignment: STYLE.ALIGN_CENTER,
    attribute: STYLE.FONT_BOLD,
  })
  await printSeparator()

  await printText(`${roomNumber}\n\n`, {
    alignment: STYLE.ALIGN_CENTER,
    attribute: STYLE.FONT_BOLD,
    textSize: STYLE.SIZE_DOUBLE,
  })

  if (password) {
    await printText("객실 비밀번호\n", {
      alignment: STYLE.ALIGN_CENTER,
    })
    await printText(`${password}\n\n`, {
      alignment: STYLE.ALIGN_CENTER,
      attribute: STYLE.FONT_BOLD | STYLE.FONT_UNDERLINE,
      textSize: STYLE.SIZE_DOUBLE,
    })
  }

  await printSeparator()
  await printText("도어락 이용 방법\n\n", {
    alignment: STYLE.ALIGN_CENTER,
    attribute: STYLE.FONT_BOLD,
    textSize: STYLE.SIZE_DOUBLE_HEIGHT,
  })
  await printText(
    "1. 도어락 화면을 손으로 터치하세요.\n" +
      "2. 숫자 자판이 나타날 때까지 기다리세요.\n" +
      (password ? `3. 비밀번호 ${password}를 입력하세요.\n` : "") +
      "4. 문이 열리면 입실하세요.\n\n",
  )

  if (checkInDate || checkOutDate) {
    await printSeparator()
    if (checkInDate) await printText(`체크인    ${checkInDate}\n`)
    if (checkOutDate) await printText(`체크아웃  ${checkOutDate}\n`)
    await printText("\n")
  }

  await printText(
    "즐거운 시간 보내시기 바랍니다.\n감사합니다.\n\n\n",
    {
      alignment: STYLE.ALIGN_CENTER,
      attribute: STYLE.FONT_BOLD,
    },
  )

  await cutPaper()

  console.log("[Bixolon] Print command sent.")
  return true
}

async function printSeparator() {
  await printText("------------------------------------------\n", {
    alignment: STYLE.ALIGN_CENTER,
  })
}

function formatRoomNumber(value: string): string {
  const room = String(value || "").trim()
  const match = room.replace(/\s/g, "").match(/^([A-Za-z])(\d+)$/)
  if (match) return `${match[1].toUpperCase()}동 ${match[2]}호`
  return room
}

function formatReceiptDate(value?: string): string {
  if (!value) return ""

  const match = String(value).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (match) {
    return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`
  }

  return String(value)
}

function formatPaymentDate(value: number): string {
  const timestamp = value < 10_000_000_000 ? value * 1000 : value
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

function formatReceiptAmount(value: number): string {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`
}

// --------------------------------------------------------
// Shim Functions for Compatibility
// --------------------------------------------------------

export async function autoConnectPrinter(): Promise<boolean> {
  // New hardware server architecture handles connection automatically on startup.
  // We just return true here to allow the dependent components to proceed.
  console.log("[Bixolon] autoConnectPrinter called (shim): Connection managed by Hardware Server.")
  return true;
}

export function isPrinterConnected(): boolean {
  // We can't synchronously check invalid hardware server status easily without an async call.
  // Ideally, we should check a cached status from the electron-IPC event listener.
  // For now, returning true is safe as the actual print call will fail gracefully if disconnected.
  // TODO: Hook into a global context or Redux/Zustand store for real-time status if needed.
  return true;
}

export async function printRoomInfoReceipt(data: {
  roomNumber: string;
  password: string;
  floor: string;
}): Promise<boolean> {
  console.log("[Bixolon] printRoomInfoReceipt called (shim).");
  try {
    const now = new Date();
    await printReceipt({
      hotelName: "THE BEACH STAY", // English Name
      roomNumber: data.roomNumber,
      password: data.password,
      checkInDate: now.toLocaleDateString(),
    });
    return true;
  } catch (error) {
    console.error("[Bixolon] printRoomInfoReceipt failed:", error);
    return false;
  }
}

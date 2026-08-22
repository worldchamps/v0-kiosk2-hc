/**
 * 통합 프린터 유틸리티 (Hardware Server IPC 버전)
 * 기존 Web Serial 로직을 제거하고 Hardware Server로 모든 요청을 위임합니다.
 */

import { getKioskPropertyId, propertyUsesPrinter } from "./property-utils"
import * as HardwarePrinter from "@/lib/printer-utils"

function shouldUsePrinter(): boolean {
  const property = getKioskPropertyId()
  return propertyUsesPrinter(property)
}

/**
 * 프린터 연결 (Hardware Server가 자동 관리하므로 true 리턴)
 */
export async function connectPrinter(): Promise<boolean> {
  if (!shouldUsePrinter()) return false
  return HardwarePrinter.autoConnectPrinter()
}

/**
 * 자동 프린터 연결
 */
export async function autoConnectPrinter(): Promise<boolean> {
  if (!shouldUsePrinter()) return false
  return HardwarePrinter.autoConnectPrinter()
}

/**
 * 프린터 연결 해제 (Hardware Server 상태이므로 실제 해제 안 함)
 */
export async function disconnectPrinter(): Promise<void> {
  // No-op
  console.log("[PRINTER] disconnectPrinter request ignored (Managed by Hardware Server)")
}

/**
 * 프린터 연결 상태 확인
 */
export function isPrinterConnected(): boolean {
  if (!shouldUsePrinter()) return false
  return HardwarePrinter.isPrinterConnected()
}

/**
 * 영수증 인쇄
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  if (!shouldUsePrinter()) return false

  const property = getKioskPropertyId()

  // Map generic receipt data to RoomInfo if possible, otherwise print generic text
  // This depends on what receiptData looks like.
  // For now, assume it's Room Info or has similar fields.
  if (receiptData.roomNumber) {
    return HardwarePrinter.printReceipt({
      hotelName:
        process.env.NEXT_PUBLIC_RECEIPT_HOTEL_NAME ||
        (property === "property4" ? "THE CAMP STAY" : "THE BEACH STAY"),
      roomNumber: receiptData.roomNumber,
      password: receiptData.password || "",
      checkInDate: receiptData.checkInDate || "",
      checkOutDate: receiptData.checkOutDate || "",
      reservationId: receiptData.reservationId || "",
      paymentReceipt: receiptData.paymentReceipt || null,
      business: {
        name:
          process.env.NEXT_PUBLIC_RECEIPT_BUSINESS_NAME ||
          (property === "property4" ? "더캠프스테이" : "더 비치스테이"),
        registrationNumber: process.env.NEXT_PUBLIC_RECEIPT_BUSINESS_NUMBER || "",
        representative: process.env.NEXT_PUBLIC_RECEIPT_REPRESENTATIVE || "",
        address: process.env.NEXT_PUBLIC_RECEIPT_ADDRESS || "",
        phone: process.env.NEXT_PUBLIC_RECEIPT_PHONE || "",
      },
    })
  }

  // Fallback: Print raw text if possible? HardwarePrinter doesn't export generic object print.
  // We'll try to just print text content.
  const text = JSON.stringify(receiptData, null, 2)
  await HardwarePrinter.printText(text + "\n\n")
  await HardwarePrinter.cutPaper()
  return true
}

/**
 * 객실 정보 영수증 인쇄
 */
export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  if (!shouldUsePrinter()) return false
  return HardwarePrinter.printRoomInfoReceipt(roomData)
}

/**
 * 테스트 페이지 인쇄
 */
export async function printTestPage(): Promise<boolean> {
  if (!shouldUsePrinter()) return false
  if (getKioskPropertyId() === "property4") {
    return HardwarePrinter.printReceipt({
      hotelName: "THE CAMP STAY",
      roomNumber: "Camp101",
      password: "1234",
      checkInDate: "2026-08-22",
      checkOutDate: "2026-08-23",
    })
  }
  await HardwarePrinter.printText("[TEST PAGE]\nHardware Server Integration\n\nSUCCESS\n\n\n\n")
  await HardwarePrinter.cutPaper()
  return true
}

/**
 * Legacy Stub Functions
 */
export function setSimplePrintMode(simple: boolean): void { }
export function getSimplePrintMode(): boolean { return false }
export function getPrinterModel(): string {
  return getKioskPropertyId() === "property4" ? "SAM4S GCUBE (Windows)" : "Bixolon (HW Server)"
}
export function getPrinterStatus(): any {
  return {
    connected: true,
    model: getKioskPropertyId() === "property4" ? "SAM4S_GCUBE_WINDOWS" : "HW_SERVER",
    simpleMode: false,
  }
}
export function getPrinterDiagnostics(): any {
  return { connected: true, message: "Managed by Hardware Server" }
}
export async function checkPrinterStatus(): Promise<{
  success: boolean
  online: boolean
  paperOk: boolean
  error: boolean
  message: string
}> {
  const connected = isPrinterConnected()
  return {
    success: connected,
    online: connected,
    paperOk: connected,
    error: !connected,
    message: connected ? "Hardware Server에서 프린터를 관리하고 있습니다." : "프린터를 사용할 수 없습니다.",
  }
}
export function getCommandLog(): Array<{ command: string; bytes: number[]; timestamp: string }> {
  return []
}
export function clearCommandLog(): void { }

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

  // Map generic receipt data to RoomInfo if possible, otherwise print generic text
  // This depends on what receiptData looks like.
  // For now, assume it's Room Info or has similar fields.
  if (receiptData.roomNumber) {
    return HardwarePrinter.printRoomInfoReceipt({
      roomNumber: receiptData.roomNumber,
      password: receiptData.password || "",
      floor: receiptData.floor || ""
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
  await HardwarePrinter.printText("[TEST PAGE]\nHardware Server Integration\n\nSUCCESS\n\n\n\n")
  await HardwarePrinter.cutPaper()
  return true
}

/**
 * Legacy Stub Functions
 */
export function setSimplePrintMode(simple: boolean): void { }
export function getSimplePrintMode(): boolean { return false }
export function getPrinterModel(): string { return "Bixolon (HW Server)" }
export function getPrinterStatus(): any {
  return { connected: true, model: "HW_SERVER", simpleMode: false }
}
export function getPrinterDiagnostics(): any {
  return { connected: true, message: "Managed by Hardware Server" }
}
export function getCommandLog(): Array<{ command: string; bytes: number[]; timestamp: string }> {
  return []
}
export function clearCommandLog(): void { }

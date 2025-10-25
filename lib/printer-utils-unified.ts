/**
 * 통합 프린터 유틸리티
 * Property별로 적절한 프린터 방식 선택
 * - Property1, 2: 프린터 사용 안함
 * - Property3, 4: Web Serial Port 사용
 */

import { getKioskPropertyId, propertyUsesPrinter } from "./property-utils"
import * as WebSerialPrinter from "./printer-utils-webserial"

function shouldUsePrinter(): boolean {
  const property = getKioskPropertyId()
  return propertyUsesPrinter(property)
}

/**
 * 프린터 연결
 */
export async function connectPrinter(): Promise<boolean> {
  if (!shouldUsePrinter()) {
    console.log("[PRINTER] Property1,2는 프린터를 사용하지 않습니다.")
    return false
  }

  return WebSerialPrinter.connectPrinter()
}

/**
 * 자동 프린터 연결
 */
export async function autoConnectPrinter(): Promise<boolean> {
  if (!shouldUsePrinter()) {
    console.log("[PRINTER] Property1,2는 프린터를 사용하지 않습니다.")
    return false
  }

  return WebSerialPrinter.autoConnectPrinter()
}

/**
 * 프린터 연결 해제
 */
export async function disconnectPrinter(): Promise<void> {
  if (!shouldUsePrinter()) {
    return
  }

  return WebSerialPrinter.disconnectPrinter()
}

/**
 * 프린터 연결 상태 확인
 */
export function isPrinterConnected(): boolean {
  if (!shouldUsePrinter()) {
    return false
  }

  return WebSerialPrinter.isPrinterConnected()
}

/**
 * 영수증 인쇄
 */
export async function printReceipt(receiptData: any): Promise<boolean> {
  if (!shouldUsePrinter()) {
    console.log("[PRINTER] Property1,2는 프린터를 사용하지 않습니다.")
    return false
  }

  return WebSerialPrinter.printReceipt(receiptData)
}

/**
 * 객실 정보 영수증 인쇄
 */
export async function printRoomInfoReceipt(roomData: any): Promise<boolean> {
  if (!shouldUsePrinter()) {
    console.log("[PRINTER] Property1,2는 프린터를 사용하지 않습니다.")
    return false
  }

  return WebSerialPrinter.printRoomInfoReceipt(roomData)
}

/**
 * 테스트 페이지 인쇄
 */
export async function printTestPage(): Promise<boolean> {
  if (!shouldUsePrinter()) {
    console.log("[PRINTER] Property1,2는 프린터를 사용하지 않습니다.")
    return false
  }

  return WebSerialPrinter.printTestPage()
}

/**
 * Simple Mode 설정
 */
export function setSimplePrintMode(simple: boolean): void {
  WebSerialPrinter.setSimplePrintMode(simple)
}

/**
 * Simple Mode 상태 확인
 */
export function getSimplePrintMode(): boolean {
  return WebSerialPrinter.getSimplePrintMode()
}

/**
 * 프린터 모델 가져오기
 */
export function getPrinterModel(): string {
  return WebSerialPrinter.getPrinterModel()
}

/**
 * 프린터 상태 정보
 */
export function getPrinterStatus(): any {
  if (!shouldUsePrinter()) {
    return {
      connected: false,
      model: "NOT_USED",
      simpleMode: false,
    }
  }

  return WebSerialPrinter.getPrinterStatus()
}

/**
 * 프린터 진단 정보
 */
export function getPrinterDiagnostics(): any {
  if (!shouldUsePrinter()) {
    return {
      connected: false,
      model: "NOT_USED",
      message: "Property1,2는 프린터를 사용하지 않습니다.",
    }
  }

  return WebSerialPrinter.getPrinterDiagnostics()
}

/**
 * 명령어 로그 가져오기
 */
export function getCommandLog(): Array<{ command: string; bytes: number[]; timestamp: string }> {
  return WebSerialPrinter.getCommandLog()
}

/**
 * 명령어 로그 지우기
 */
export function clearCommandLog(): void {
  WebSerialPrinter.clearCommandLog()
}

"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Printer, Loader2 } from "lucide-react"

interface ReceiptData {
  guestName: string
  roomNumber: string
  roomType: string
  checkInDate: string
  checkOutDate: string
  price?: string
  reservationId: string
  timestamp?: string
  password?: string
  floor?: string
}

interface ReceiptPrinterProps {
  receiptData: ReceiptData
  onClose?: () => void
}

export default function ReceiptPrinter({ receiptData, onClose }: ReceiptPrinterProps) {
  const [isPrinting, setIsPrinting] = useState(false)
  const receiptRef = useRef<HTMLDivElement>(null)

  // 현재 시간 포맷팅
  const formatTime = () => {
    const now = new Date()
    return now.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }

  const formatDateForReceipt = (dateString: string) => {
    if (!dateString) return "N/A"

    // 이미 YYYY.MM.DD 형식이면 그대로 반환
    if (dateString.includes(".")) return dateString

    // YYYY-MM-DD 형식을 YYYY.MM.DD로 변환
    return dateString.replace(/-/g, ".")
  }

  // 객실 타입을 영어로 변환하는 함수
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

  // 영수증 인쇄 함수
  const handlePrint = () => {
    setIsPrinting(true)

    setTimeout(() => {
      try {
        const originalContents = document.body.innerHTML
        const printContents = receiptRef.current?.innerHTML || ""

        // 인쇄용 스타일 추가
        const printStyles = `
          <style>
            @page { size: 80mm 200mm; margin: 0; }
            body { font-family: 'Do Hyeon', sans-serif; width: 76mm; margin: 2mm; }
            .receipt { width: 100%; }
            .receipt-header { text-align: center; margin-bottom: 10px; font-size: 24px; font-weight: bold; }
            .receipt-divider { border-top: 1px dashed #000; margin: 10px 0; }
            .receipt-body { margin: 15px 0; font-size: 20px; }
            .receipt-row { display: flex; justify-content: space-between; margin: 8px 0; }
            .receipt-label { font-weight: bold; }
            .receipt-room-number { font-size: 32px; font-weight: bold; }
          </style>
        `

        // 인쇄용 문서 생성
        document.body.innerHTML = printStyles + printContents

        // 인쇄 다이얼로그 열기
        window.print()

        // 원래 문서로 복원
        document.body.innerHTML = originalContents

        setIsPrinting(false)
      } catch (error) {
        console.error("인쇄 중 오류 발생:", error)
        setIsPrinting(false)
      }
    }, 500)
  }

  // 층수 정보를 영수증에 표시하도록 수정
  // 층수 결정
  const roomNumber = receiptData.roomNumber || "000"
  const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"

  // 객실 타입을 영어로 변환
  const englishRoomType = translateRoomType(receiptData.roomType)

  return (
    <div className="p-4">
      {/* 실제 인쇄될 영수증 (숨겨진 상태) */}
      <div ref={receiptRef} className="receipt" style={{ display: "none" }}>
        <div className="receipt-header">The Beach Stay</div>

        <div className="receipt-divider"></div>

        <div className="receipt-body">
          <div className="receipt-row">
            <span className="receipt-room-number">
              {floor} {receiptData.roomNumber}
            </span>
          </div>

          <div className="receipt-row">
            <span>Door PW: {receiptData.password || "0000"}</span>
          </div>

          <div className="receipt-divider"></div>

          <div className="receipt-row">
            <span>Check-in: {formatDateForReceipt(receiptData.checkInDate)}</span>
          </div>

          <div className="receipt-row">
            <span>Check-out: {formatDateForReceipt(receiptData.checkOutDate)}</span>
          </div>
        </div>

        <div className="receipt-divider"></div>
      </div>

      {/* 사용자 인터페이스 */}
      <div className="flex flex-col space-y-4">
        <h3 className="text-xl font-bold">영수증 출력</h3>

        <div className="flex space-x-4">
          <Button onClick={handlePrint} disabled={isPrinting} className="flex items-center space-x-2">
            {isPrinting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>인쇄 중...</span>
              </>
            ) : (
              <>
                <Printer className="h-5 w-5" />
                <span>영수증 인쇄</span>
              </>
            )}
          </Button>

          <Button variant="outline" onClick={onClose} disabled={isPrinting}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  )
}

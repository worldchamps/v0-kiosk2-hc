"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { X, Printer, Check } from "lucide-react"
import { printReceipt } from "@/lib/printer-utils"

interface ReceiptPrinterProps {
  reservation: any
  revealedInfo: {
    roomNumber: string
    password: string
    floor: string
  }
  onClose: () => void
}

export default function ReceiptPrinter({ reservation, revealedInfo, onClose }: ReceiptPrinterProps) {
  const [isPrinting, setIsPrinting] = useState(false)
  const [printSuccess, setPrintSuccess] = useState(false)

  const handlePrint = async () => {
    setIsPrinting(true)
    try {
      const receiptData = {
        guestName: reservation.guestName,
        roomCode: reservation.roomCode || revealedInfo.roomNumber, // roomCode 사용
        roomType: reservation.roomType,
        checkInDate: reservation.checkInDate,
        checkOutDate: reservation.checkOutDate,
        password: revealedInfo.password,
        reservationId: reservation.reservationId,
        totalAmount: reservation.totalAmount || reservation.price || 0,
        printTime: new Date().toLocaleString("ko-KR"),
      }

      const success = await printReceipt(receiptData)

      if (success) {
        setPrintSuccess(true)
        setTimeout(() => {
          onClose()
        }, 2000)
      } else {
        alert("영수증 출력에 실패했습니다. 다시 시도해주세요.")
      }
    } catch (error) {
      console.error("Print error:", error)
      alert("영수증 출력 중 오류가 발생했습니다.")
    } finally {
      setIsPrinting(false)
    }
  }

  if (printSuccess) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <Check className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-green-600 mb-2">출력 완료!</h3>
            <p className="text-lg text-gray-600">영수증이 출력되었습니다</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-[500px] max-h-[80vh] overflow-auto">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-bold">영수증 출력</h3>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-6 w-6" />
            </Button>
          </div>

          {/* 영수증 미리보기 */}
          <div className="bg-white border-2 border-gray-300 p-6 mb-6 font-mono text-sm">
            <div className="text-center mb-4">
              <h4 className="text-lg font-bold">더 비치스테이</h4>
              <p>체크인 영수증</p>
              <p>{new Date().toLocaleString("ko-KR")}</p>
            </div>

            <div className="border-t border-b border-gray-300 py-4 my-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>예약자명:</span>
                  <span>{reservation.guestName}</span>
                </div>
                <div className="flex justify-between">
                  <span>객실번호:</span>
                  <span>{reservation.roomCode || revealedInfo.roomNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>객실타입:</span>
                  <span>{reservation.roomType}</span>
                </div>
                <div className="flex justify-between">
                  <span>체크인:</span>
                  <span>{reservation.checkInDate}</span>
                </div>
                <div className="flex justify-between">
                  <span>체크아웃:</span>
                  <span>{reservation.checkOutDate}</span>
                </div>
                <div className="flex justify-between">
                  <span>출입번호:</span>
                  <span>{revealedInfo.password}</span>
                </div>
                <div className="flex justify-between">
                  <span>예약번호:</span>
                  <span>{reservation.reservationId}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>결제금액:</span>
                  <span>{(reservation.totalAmount || reservation.price || 0).toLocaleString()}원</span>
                </div>
              </div>
            </div>

            <div className="text-center text-xs">
              <p>감사합니다</p>
              <p>즐거운 여행 되세요!</p>
            </div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" onClick={onClose} className="flex-1 bg-transparent" disabled={isPrinting}>
              취소
            </Button>
            <Button onClick={handlePrint} className="flex-1" disabled={isPrinting}>
              {isPrinting ? (
                "출력 중..."
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4" />
                  출력하기
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

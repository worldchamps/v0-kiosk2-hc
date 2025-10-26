"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Banknote, CheckCircle2, XCircle, AlertCircle } from "lucide-react"
import { usePayment } from "@/contexts/payment-context"
import {
  connectBillAcceptor,
  enableAcceptance,
  disableAcceptance,
  setConfig,
  getBillData,
  isBillAcceptorConnected,
  setEventCallback,
} from "@/lib/bill-acceptor-utils"

interface PaymentScreenProps {
  requiredAmount: number
  onPaymentComplete: () => void
  onCancel: () => void
  title?: string
  description?: string
}

export default function PaymentScreen({
  requiredAmount,
  onPaymentComplete,
  onCancel,
  title = "결제",
  description = "지폐를 투입해주세요",
}: PaymentScreenProps) {
  const { paymentSession, addBill, isPaymentComplete } = usePayment()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string>("")
  const [statusMessage, setStatusMessage] = useState<string>("지폐인식기 연결 중...")

  const handleBillRecognitionEvent = useCallback(
    async (eventData: number) => {
      console.log("[v0] Event received:", eventData.toString(16))

      // 0x05 = RECOGNITION_END (지폐 인식 완료)
      if (eventData === 0x05) {
        console.log("[v0] Bill recognition complete event received")
        setStatusMessage("지폐 인식 완료, 처리 중...")

        try {
          // 1초 대기
          await new Promise((resolve) => setTimeout(resolve, 1000))

          // Event TX 자동 송신 모드 OFF
          console.log("[v0] Disabling Event TX auto send mode")
          const configOff = await setConfig(0x1c) // 0x1C = Event TX OFF
          if (!configOff) {
            console.error("[v0] Failed to disable Event TX mode")
            setError("설정 변경 실패")
            return
          }

          // 1초 대기
          await new Promise((resolve) => setTimeout(resolve, 1000))

          // 지폐 데이터 확인
          console.log("[v0] Getting bill data")
          const billData = await getBillData()
          if (billData === null) {
            console.error("[v0] Failed to get bill data")
            setError("지폐 데이터 확인 실패")
            return
          }

          // 지폐 금액 변환
          let amount = 0
          switch (billData) {
            case 0x0a: // 1만원
              amount = 10000
              break
            case 0x32: // 5만원
              amount = 50000
              break
            case 0x01: // 1천원
              amount = 1000
              break
            case 0x05: // 5천원
              amount = 5000
              break
            default:
              console.error("[v0] Unknown bill type:", billData.toString(16))
              setError(`알 수 없는 지폐 종류: 0x${billData.toString(16)}`)
              return
          }

          console.log("[v0] Bill amount:", amount)
          addBill(amount)
          setStatusMessage(`${amount.toLocaleString()}원 수취 완료`)

          // 충족 금액 달성 확인
          if (isPaymentComplete()) {
            console.log("[v0] Payment complete!")
            setStatusMessage("결제 완료!")
            return
          }

          // 다음 지폐를 위해 다시 Event TX 모드 ON 및 입수가능 활성화
          console.log("[v0] Preparing for next bill")
          await new Promise((resolve) => setTimeout(resolve, 500))

          // 입수가능 명령
          const enabled = await enableAcceptance()
          if (!enabled) {
            console.error("[v0] Failed to enable acceptance")
            setError("지폐 수취 활성화 실패")
            return
          }

          // Event TX 자동 송신 모드 ON
          const configOn = await setConfig(0x3c) // 0x3C = Event TX ON
          if (!configOn) {
            console.error("[v0] Failed to enable Event TX mode")
            setError("설정 변경 실패")
            return
          }

          setStatusMessage("추가 지폐를 투입해주세요...")
        } catch (error) {
          console.error("[v0] Error processing bill:", error)
          setError(`처리 오류: ${error}`)
        }
      }
    },
    [addBill, isPaymentComplete],
  )

  useEffect(() => {
    const initializePayment = async () => {
      setIsConnecting(true)
      setError("")

      try {
        // 1. 지폐인식기 연결 확인
        if (!isBillAcceptorConnected()) {
          setStatusMessage("지폐인식기 연결 중...")
          const connected = await connectBillAcceptor()
          if (!connected) {
            setError("지폐인식기 연결 실패")
            setIsConnecting(false)
            return
          }
        }

        console.log("[v0] Bill acceptor connected")

        // 2. 이벤트 콜백 등록
        setEventCallback(handleBillRecognitionEvent)
        console.log("[v0] Event callback registered")

        // 3. 입수가능 명령
        setStatusMessage("지폐 수취 준비 중...")
        const enabled = await enableAcceptance()
        if (!enabled) {
          setError("지폐 수취 활성화 실패")
          setIsConnecting(false)
          return
        }

        console.log("[v0] Bill acceptance enabled")

        // 4. Event TX 자동 송신 모드 ON
        setStatusMessage("이벤트 모드 설정 중...")
        const configSet = await setConfig(0x3c) // 0x3C = Event TX ON
        if (!configSet) {
          setError("설정 변경 실패")
          setIsConnecting(false)
          return
        }

        console.log("[v0] Event TX mode enabled")

        setStatusMessage("지폐를 투입해주세요...")
        setIsConnecting(false)
        setIsProcessing(true)
      } catch (error) {
        console.error("[v0] Payment initialization error:", error)
        setError(`초기화 오류: ${error}`)
        setIsConnecting(false)
      }
    }

    initializePayment()

    return () => {
      console.log("[v0] Cleaning up payment screen")
      setEventCallback(null)
      disableAcceptance()
      setConfig(0x1c) // Event TX OFF
    }
  }, [handleBillRecognitionEvent])

  // 결제 완료 감지
  useEffect(() => {
    if (isPaymentComplete()) {
      console.log("[v0] Payment complete detected")
      setIsProcessing(false)
      onPaymentComplete()
    }
  }, [isPaymentComplete, onPaymentComplete])

  const remainingAmount = requiredAmount - paymentSession.acceptedAmount

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">{title}</h1>
          <div className="kiosk-highlight">{description}</div>
        </div>

        <div className="w-full space-y-6 mt-8">
          {/* 결제 정보 카드 */}
          <Card className="shadow-lg">
            <CardContent className="p-8">
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-semibold">필요 금액</span>
                  <span className="text-3xl font-bold">{requiredAmount.toLocaleString()}원</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-2xl font-semibold">투입 금액</span>
                  <span className="text-3xl font-bold text-green-600">
                    {paymentSession.acceptedAmount.toLocaleString()}원
                  </span>
                </div>

                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-2xl font-semibold">남은 금액</span>
                    <span className="text-4xl font-bold text-blue-600">{remainingAmount.toLocaleString()}원</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 투입된 지폐 목록 */}
          {paymentSession.acceptedBills.length > 0 && (
            <Card className="shadow-md">
              <CardContent className="p-6">
                <h3 className="text-xl font-semibold mb-4">투입된 지폐</h3>
                <div className="flex flex-wrap gap-2">
                  {paymentSession.acceptedBills.map((bill, index) => (
                    <div key={index} className="flex items-center gap-2 bg-green-100 px-4 py-2 rounded-lg">
                      <Banknote className="h-5 w-5 text-green-600" />
                      <span className="font-semibold text-green-700">{bill.toLocaleString()}원</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 상태 메시지 */}
          <Card className="shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                {isConnecting || isProcessing ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    <span className="text-xl">{statusMessage}</span>
                  </>
                ) : error ? (
                  <>
                    <XCircle className="h-8 w-8 text-red-500" />
                    <span className="text-xl text-red-600">{error}</span>
                  </>
                ) : isPaymentComplete() ? (
                  <>
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                    <span className="text-xl text-green-600">결제가 완료되었습니다!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-8 w-8 text-blue-500" />
                    <span className="text-xl">{statusMessage}</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 취소 버튼 */}
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isConnecting || isProcessing}
            className="h-20 text-2xl w-full border-3 border-gray-300 font-bold bg-transparent"
          >
            취소
          </Button>
        </div>
      </div>
    </div>
  )
}

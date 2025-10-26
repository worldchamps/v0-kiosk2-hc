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
  getStatus,
  getBillData,
  stackBill,
  returnBill,
  isBillAcceptorConnected,
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

  // 지폐 인식 프로세스
  const processBillAcceptance = useCallback(async () => {
    if (isProcessing) return

    setIsProcessing(true)
    setError("")

    try {
      // 1. 지폐 수취 활성화
      const enabled = await enableAcceptance()
      if (!enabled) {
        setError("지폐 수취 활성화 실패")
        setIsProcessing(false)
        return
      }

      setStatusMessage("지폐를 투입해주세요...")

      let attempts = 0
      const maxAttempts = 30 // 60초 타임아웃 (2초 간격)

      while (attempts < maxAttempts && !isPaymentComplete()) {
        const status = await getStatus()

        if (status === null) {
          setError("상태 확인 실패")
          await disableAcceptance()
          setIsProcessing(false)
          return
        }

        // 지폐 인식 완료 (에스크로 상태)
        if (status === 0x05) {
          setStatusMessage("지폐 확인 중...")

          const billData = await getBillData()
          if (billData === null) {
            setError("지폐 데이터 확인 실패")
            await returnBill()
            await disableAcceptance()
            setIsProcessing(false)
            return
          }

          // 지폐 금액 변환
          let amount = 0
          switch (billData) {
            case 1:
              amount = 1000
              break
            case 5:
              amount = 5000
              break
            case 10:
              amount = 10000
              break
            case 50:
              amount = 50000
              break
            default:
              setError(`알 수 없는 지폐 종류: ${billData}`)
              await returnBill()
              await disableAcceptance()
              setIsProcessing(false)
              return
          }

          // 3. 지폐 적재
          setStatusMessage(`${amount.toLocaleString()}원 처리 중...`)
          const stacked = await stackBill()

          if (!stacked) {
            setError("지폐 적재 실패")
            await returnBill()
            await disableAcceptance()
            setIsProcessing(false)
            return
          }

          // 4. 적재 완료 대기
          let stackAttempts = 0
          while (stackAttempts < 20) {
            const stackStatus = await getStatus()
            if (stackStatus === 0x0b) {
              // STACK_END
              addBill(amount)
              setStatusMessage(`${amount.toLocaleString()}원 수취 완료`)
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 2000))
            stackAttempts++
          }

          // 충족 금액 달성 확인
          if (isPaymentComplete()) {
            await disableAcceptance()
            setStatusMessage("결제 완료!")
            setIsProcessing(false)
            return
          }

          // 다음 지폐 대기
          setStatusMessage("추가 지폐를 투입해주세요...")
        }

        // 에러 확인
        if (status === 0x0c) {
          setError("지폐인식기 오류 발생")
          await disableAcceptance()
          setIsProcessing(false)
          return
        }

        await new Promise((resolve) => setTimeout(resolve, 2000))
        attempts++
      }

      // 타임아웃
      if (!isPaymentComplete()) {
        await disableAcceptance()
        setIsProcessing(false)
      }
    } catch (error) {
      console.error("[v0] Bill acceptance error:", error)
      setError(`처리 오류: ${error}`)
      await disableAcceptance()
      setIsProcessing(false)
    }
  }, [isProcessing, addBill, isPaymentComplete])

  // 초기 연결 및 결제 프로세스 시작
  useEffect(() => {
    const initializePayment = async () => {
      setIsConnecting(true)
      setError("")

      try {
        // 지폐인식기 연결 확인
        if (!isBillAcceptorConnected()) {
          setStatusMessage("지폐인식기 연결 중...")
          const connected = await connectBillAcceptor()
          if (!connected) {
            setError("지폐인식기 연결 실패")
            setIsConnecting(false)
            return
          }
        }

        setStatusMessage("결제 준비 완료")
        setIsConnecting(false)

        // 지폐 인식 프로세스 시작
        processBillAcceptance()
      } catch (error) {
        console.error("[v0] Payment initialization error:", error)
        setError(`초기화 오류: ${error}`)
        setIsConnecting(false)
      }
    }

    initializePayment()

    // 컴포넌트 언마운트 시 지폐 수취 비활성화
    return () => {
      disableAcceptance()
    }
  }, [processBillAcceptance])

  // 결제 완료 감지
  useEffect(() => {
    if (isPaymentComplete()) {
      console.log("[v0] Payment complete detected")
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

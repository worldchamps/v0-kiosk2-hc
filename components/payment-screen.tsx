"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Banknote, CheckCircle2, XCircle, AlertCircle } from "lucide-react"
import { usePayment } from "@/contexts/payment-context"
import {
  connectBillAcceptor,
  enableAcceptance,
  setConfig,
  getBillData,
  isBillAcceptorConnected,
  setEventCallback,
  initializeDevice,
} from "@/lib/bill-acceptor-utils"
import { dispenseBills } from "@/lib/bill-dispenser-utils"

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
  const paymentCompleteRef = useRef(false)

  const handleBillRecognitionEvent = useCallback(
    async (eventData: number) => {
      console.log("[v0] Event received:", eventData.toString(16))

      if (eventData === 0x01) {
        console.log("[v0] WAIT event received, ignoring")
        return
      }

      if (eventData === 0x0b) {
        console.log("[v0] STACK_END event received")
        setStatusMessage("지폐 처리 중...")

        try {
          await new Promise((resolve) => setTimeout(resolve, 1000))

          console.log("[v0] Disabling Event TX auto send mode")
          const configOff = await setConfig(0x1c)
          if (!configOff) {
            console.error("[v0] Failed to disable Event TX mode")
            setError("설정 변경 실패")
            return
          }

          await new Promise((resolve) => setTimeout(resolve, 1000))

          console.log("[v0] Getting bill data")
          const billData = await getBillData()
          if (billData === null) {
            console.error("[v0] Failed to get bill data")
            setError("지폐 데이터 확인 실패")
            return
          }

          let amount = 0
          switch (billData) {
            case 0x0a:
              amount = 10000
              break
            case 0x32:
              amount = 50000
              break
            case 0x01:
              amount = 1000
              break
            case 0x05:
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

          const newTotal = paymentSession.acceptedAmount + amount
          if (newTotal >= requiredAmount) {
            console.log("[v0] Payment complete! Processing...")
            setIsProcessing(false)
            paymentCompleteRef.current = true

            setEventCallback(null)

            try {
              setStatusMessage("디바이스 초기화 중...")
              console.log("[v0] Initializing device...")
              const initialized = await initializeDevice()
              if (initialized) {
                console.log("[v0] Device initialized successfully")
              } else {
                console.error("[v0] Device initialization failed")
              }
            } catch (error) {
              console.error("[v0] Failed to initialize device:", error)
            }

            const overpayment = newTotal - requiredAmount
            if (overpayment > 0) {
              console.log(`[v0] Overpayment detected: ${overpayment}원`)
              setStatusMessage(`거스름돈 ${overpayment.toLocaleString()}원 반환 중...`)

              try {
                const billCount = Math.floor(overpayment / 10000)
                console.log(`[v0] Dispensing ${billCount} bills of 10,000 won`)

                const dispensed = await dispenseBills(billCount)

                if (dispensed) {
                  console.log("[v0] Change dispensed successfully")
                  setStatusMessage(`거스름돈 ${overpayment.toLocaleString()}원 반환 완료!`)
                  await new Promise((resolve) => setTimeout(resolve, 2000))
                } else {
                  console.error("[v0] Failed to dispense change")
                  setError(`거스름돈 반환 실패. 관리자에게 문의하세요. (${overpayment.toLocaleString()}원)`)
                  await new Promise((resolve) => setTimeout(resolve, 3000))
                }
              } catch (error) {
                console.error("[v0] Change refund error:", error)
                setError(`거스름돈 반환 오류: ${error}`)
                await new Promise((resolve) => setTimeout(resolve, 3000))
              }
            } else {
              setStatusMessage("결제 완료!")
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }

            onPaymentComplete()
            return
          }

          console.log("[v0] Preparing for next bill")
          await new Promise((resolve) => setTimeout(resolve, 500))

          const enabled = await enableAcceptance()
          if (!enabled) {
            console.error("[v0] Failed to enable acceptance")
            setError("지폐 수취 활성화 실패")
            return
          }

          const configOn = await setConfig(0x3c)
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
    [addBill, paymentSession.acceptedAmount, requiredAmount, onPaymentComplete],
  )

  useEffect(() => {
    const initializePayment = async () => {
      setIsConnecting(true)
      setError("")

      try {
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

        setEventCallback(handleBillRecognitionEvent)
        console.log("[v0] Event callback registered")

        setStatusMessage("지폐 수취 준비 중...")
        const enabled = await enableAcceptance()
        if (!enabled) {
          setError("지폐 수취 활성화 실패")
          setIsConnecting(false)
          return
        }

        console.log("[v0] Bill acceptance enabled")

        setStatusMessage("이벤트 모드 설정 중...")
        const configSet = await setConfig(0x3c)
        if (!configSet) {
          setError("설정 변경 실패")
          setIsConnecting(false)
          return
        }

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
      setConfig(0x1c)
    }
  }, [handleBillRecognitionEvent])

  const remainingAmount = requiredAmount - paymentSession.acceptedAmount

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">{title}</h1>
          <div className="kiosk-highlight">{description}</div>
        </div>

        <div className="w-full space-y-6 mt-8">
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

                {paymentSession.overpaymentAmount > 0 && (
                  <div className="flex justify-between items-center bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-semibold text-blue-700">거스름돈</span>
                    </div>
                    <span className="text-3xl font-bold text-blue-600">
                      {paymentSession.overpaymentAmount.toLocaleString()}원
                    </span>
                  </div>
                )}

                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-2xl font-semibold">남은 금액</span>
                    <span className="text-4xl font-bold text-blue-600">
                      {Math.max(0, remainingAmount).toLocaleString()}원
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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

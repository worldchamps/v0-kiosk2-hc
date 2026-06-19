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
  getStatus,
  isBillAcceptorConnected,
  setEventCallback,
  initializeDevice,
} from "@/lib/bill-acceptor-utils"
import { dispenseBills, connectBillDispenser, isBillDispenserConnected } from "@/lib/bill-dispenser-utils"
import { printReceipt } from "@/lib/printer-utils"

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
  const { paymentSession, addBill, isPaymentComplete, cancelPayment } = usePayment()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string>("")
  const [statusMessage, setStatusMessage] = useState<string>("지폐인식기 연결 중...")
  const paymentCompleteRef = useRef(false)
  const [isCancelling, setIsCancelling] = useState(false)

  // Polling Interval Ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingProcessingRef = useRef(false)

  // Split completion logic for clarity and reuse
  const handlePaymentCompletion = useCallback(async (finalTotal: number) => {
    // Stop polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    console.log("[v0] Payment complete! Processing...")
    setIsProcessing(false)
    paymentCompleteRef.current = true

    try {
      setStatusMessage("디바이스 초기화 중...")
      await initializeDevice()
    } catch (e) {
      console.error("[v0] Error initializing device during completion:", e)
    }

    const overpayment = finalTotal - requiredAmount

    if (overpayment > 0) {
      console.log(`[v0] Overpayment: ${overpayment}, Starting refund process...`)
      setStatusMessage(`거스름돈 ${overpayment.toLocaleString()}원 반환 중...`)

      try {
        const billCount = Math.floor(overpayment / 10000)
        if (billCount > 0) {
          console.log(`[v0] Dispensing change: ${billCount} x 10,000`)

          // Ensure dispenser is connected before trying
          if (!isBillDispenserConnected()) {
            console.log("[v0] Dispenser not connected, connecting...")
            await connectBillDispenser()
          }

          const dispensed = await dispenseBills(billCount)
          if (dispensed) {
            console.log("[v0] Change dispensed successfully")
            setStatusMessage(`거스름돈 반환 완료`)
          } else {
            console.error("[v0] Failed to dispense bills")
            setStatusMessage("거스름돈 반환 실패 (관리자 문의)")
            // Wait to let user see error
            await new Promise(r => setTimeout(r, 3000))
          }
        } else {
          console.warn("[v0] Change amount less than 1 bill unit (10,000)")
          setStatusMessage(`거스름돈 ${overpayment.toLocaleString()}원 (반환 불가 - 데스크 문의)`)
          await new Promise(r => setTimeout(r, 3000))
        }
      } catch (e) {
        console.error("[v0] Dispenser error:", e)
        setStatusMessage("거스름돈 장치 오류")
        await new Promise(r => setTimeout(r, 2000))
      }
    } else {
      setStatusMessage("결제 완료!")
    }

    console.log("[v0] Payment flow finished, navigating...")
    await new Promise(r => setTimeout(r, 1000))
    onPaymentComplete()
  }, [requiredAmount, onPaymentComplete])

  // Polling Function
  const pollDeviceStatus = useCallback(
    async () => {
      if (isPollingProcessingRef.current || paymentCompleteRef.current) return
      isPollingProcessingRef.current = true

      try {
        const status = await getStatus()

        // STACK_END (0x0B)
        if (status === 0x0b) {
          console.log("[v0] Polling: Detected STACK_END (0x0B)")
          setStatusMessage("지폐 확인 중...")

          await new Promise((resolve) => setTimeout(resolve, 500))
          const billData = await getBillData()
          console.log("[v0] Polling: Bill Data Response:", billData?.toString(16))

          if (billData !== null) {
            let amount = 0
            switch (billData) {
              case 0x0a: amount = 10000; break
              case 0x32: amount = 50000; break
              case 0x01: amount = 1000; break
              case 0x05: amount = 5000; break
              default:
                console.warn("[v0] Polling: Unknown bill code:", billData.toString(16))
                setError(`알 수 없는 지폐: 0x${billData.toString(16)}`)
                break;
            }

            if (amount > 0) {
              console.log(`[v0] Polling: Adding bill ${amount}`)
              addBill(amount)
              setStatusMessage(`${amount.toLocaleString()}원 투입됨`)

              const newTotal = paymentSession.acceptedAmount + amount
              if (newTotal >= requiredAmount) {
                return handlePaymentCompletion(newTotal)
              }
            }
          } else {
            console.error("[v0] Polling: Failed to get bill data (Response null)")
            setError("지폐 인식 실패 (응답 없음)")
          }

          console.log("[v0] Polling: Re-enabling acceptance for next bill...")
          await new Promise((resolve) => setTimeout(resolve, 500))
          await enableAcceptance()
          setStatusMessage("추가 지폐를 투입해주세요...")

        }
      } catch (e) {
        console.error("[v0] Polling error:", e)
        setError(`지폐인식기 오류: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        isPollingProcessingRef.current = false
      }
    },
    [addBill, paymentSession.acceptedAmount, requiredAmount, handlePaymentCompletion],
  )

  useEffect(() => {
    let isMounted = true

    const initializePayment = async () => {
      setIsConnecting(true)
      setError("")

      try {
        if (!isBillAcceptorConnected()) {
          setStatusMessage("지폐인식기 연결 중...")
          const connected = await connectBillAcceptor()
          if (!isMounted) return

          if (!connected) {
            setError("지폐인식기 연결 실패")
            setIsConnecting(false)
            return
          }
        }

        console.log("[v0] Bill acceptor connected")
        setStatusMessage("지폐 수취 준비 중...")
        await enableAcceptance()
        console.log("[v0] Bill acceptance enabled")

        setStatusMessage("지폐를 투입해주세요...")
        setIsConnecting(false)
        setIsProcessing(true)

        if (isMounted) {
          console.log("[v0] Starting Polling Loop")
          pollingRef.current = setInterval(() => {
            if (!paymentCompleteRef.current) pollDeviceStatus()
          }, 500)
        }

      } catch (error) {
        if (isMounted) {
          console.error("[v0] Payment initialization error:", error)
          setError(`초기화 오류: ${error}`)
          setIsConnecting(false)
        }
      }
    }

    initializePayment()

    return () => {
      isMounted = false
      console.log("[v0] Cleaning up payment screen connection")
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setConfig(0x1c) // Disable on exit
    }
  }, [pollDeviceStatus])

  const remainingAmount = requiredAmount - paymentSession.acceptedAmount

  const handleCancel = async () => {
    if (isCancelling) return

    setIsCancelling(true)
    setStatusMessage("결제 취소 중...")

    try {
      setEventCallback(null)
      console.log("[v0] Initializing bill acceptor for cancellation...")
      await initializeDevice()

      if (paymentSession.acceptedAmount > 0) {
        setStatusMessage(`${paymentSession.acceptedAmount.toLocaleString()}원 반환 중...`)

        const billCount = Math.floor(paymentSession.acceptedAmount / 10000)
        console.log(`[v0] Refunding ${billCount} bills of 10,000 won`)

        const refunded = await dispenseBills(billCount)

        if (refunded) {
          console.log("[v0] Refund successful")
          setStatusMessage("환불 완료!")
          await new Promise((resolve) => setTimeout(resolve, 2000))
        } else {
          console.error("[v0] Refund failed")
          setError("환불 실패. 관리자에게 문의하세요.")
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }

      await cancelPayment()
      onCancel()
    } catch (error) {
      console.error("[v0] Cancel error:", error)
      setError(`취소 오류: ${error}`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    } finally {
      setIsCancelling(false)
    }
  }

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
            onClick={handleCancel}
            disabled={isConnecting || isCancelling || paymentCompleteRef.current}
            className="h-20 text-2xl w-full border-3 border-gray-300 font-bold bg-transparent"
          >
            {isCancelling ? (
              <>
                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                취소 중...
              </>
            ) : (
              "취소"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Banknote, CheckCircle2, XCircle, AlertCircle, CreditCard } from "lucide-react"
import { usePayment } from "@/contexts/payment-context"
import TossFrontCardPayment from "@/components/toss-front-card-payment"
import type { CompletedPayment } from "@/lib/payment-types"
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
  cardAmount: number
  cashAmount: number
  onPaymentComplete: (payment: CompletedPayment) => void
  onCancel: () => void
  title?: string
  description?: string
}

export default function PaymentScreen({
  cardAmount,
  cashAmount,
  onPaymentComplete,
  onCancel,
  title = "결제",
  description = "결제수단을 선택해주세요",
}: PaymentScreenProps) {
  const { paymentSession, startPayment, addBill, isPaymentComplete, cancelPayment, requireRecovery, recordCashReturned } = usePayment()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string>("")
  const [statusMessage, setStatusMessage] = useState<string>("현금 결제를 준비하고 있습니다...")
  const [largeBillsOnly, setLargeBillsOnly] = useState(false)
  const paymentCompleteRef = useRef(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const cancellingRef = useRef(false)
  const acceptanceAttemptedRef = useRef(false)
  const cashInitializationRef = useRef<Promise<void> | null>(null)
  const latestSession = useRef(paymentSession)
  latestSession.current = paymentSession
  const completionCallback = useRef(onPaymentComplete)
  completionCallback.current = onPaymentComplete
  const [paymentMethod, setPaymentMethod] = useState<"select" | "cash" | "card">("select")
  const requiredAmount = paymentMethod === "card" ? cardAmount : cashAmount

  useEffect(() => {
    window.electronAPI?.getPropertyId?.().then((propertyId: string) => {
      setLargeBillsOnly(propertyId.toLowerCase() === "property4")
    })
  }, [])

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
    setIsProcessing(true)
    paymentCompleteRef.current = true

    try {
      setStatusMessage("결제를 마무리하고 있습니다...")
      if (!await initializeDevice() || !await setConfig(0x1c)) throw new Error("Acceptor shutdown not confirmed")
      acceptanceAttemptedRef.current = false
    } catch (e) {
      console.error("[v0] Error initializing device during completion:", e)
      requireRecovery("지폐 투입구 종료를 확인하지 못했습니다. 관리자에게 문의해주세요.")
      return
    }

    const overpayment = finalTotal - requiredAmount

    if (overpayment > 0) {
      console.log(`[v0] Overpayment: ${overpayment}, Starting refund process...`)
      setStatusMessage(`거스름돈 ${overpayment.toLocaleString()}원 반환 중...`)

      try {
        if (overpayment % 10000 !== 0) {
          requireRecovery(`거스름돈 ${overpayment.toLocaleString()}원을 자동 반환할 수 없습니다. 관리자에게 문의해주세요.`)
          return
        }
        const billCount = overpayment / 10000
        if (billCount > 0) {
          console.log(`[v0] Dispensing change: ${billCount} x 10,000`)

          // Ensure dispenser is connected before trying
          if (!isBillDispenserConnected()) {
            console.log("[v0] Dispenser not connected, connecting...")
            if (!await connectBillDispenser()) throw new Error("Dispenser disconnected")
          }

          const dispensed = await dispenseBills(billCount)
          if (dispensed) {
            recordCashReturned(overpayment)
            console.log("[v0] Change dispensed successfully")
            setStatusMessage(`거스름돈 반환 완료`)
          } else {
            console.error("[v0] Failed to dispense bills")
            requireRecovery("거스름돈 반환 완료를 확인하지 못했습니다. 중복 반환하지 말고 관리자에게 문의해주세요.")
            return
          }
        } else {
          console.warn("[v0] Change amount less than 1 bill unit (10,000)")
          requireRecovery(`거스름돈 ${overpayment.toLocaleString()}원을 자동 반환할 수 없습니다. 관리자에게 문의해주세요.`)
          return
        }
      } catch (e) {
        console.error("[v0] Dispenser error:", e)
        requireRecovery("거스름돈 반환 완료를 확인하지 못했습니다. 관리자에게 문의해주세요.")
        return
      }
    } else {
      setStatusMessage("결제 완료!")
    }

    console.log("[v0] Payment flow finished, navigating...")
    await new Promise(r => setTimeout(r, 1000))
    await completionCallback.current({ method: "CASH" })
  }, [requiredAmount, requireRecovery, recordCashReturned])

  // Polling Function
  const pollDeviceStatus = useCallback(
    async () => {
      if (isPollingProcessingRef.current || paymentCompleteRef.current || cancellingRef.current) return
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
                requireRecovery("투입된 지폐 금액을 확인하지 못했습니다. 추가 투입하지 말고 관리자에게 문의해주세요.")
                return
            }

            if (amount > 0) {
              console.log(`[v0] Polling: Adding bill ${amount}`)
              const newTotal = latestSession.current.acceptedAmount + amount
              addBill(amount)
              setStatusMessage(`${amount.toLocaleString()}원 투입됨`)

              if (newTotal >= requiredAmount) {
                return handlePaymentCompletion(newTotal)
              }
            }
          } else {
            console.error("[v0] Polling: Failed to get bill data (Response null)")
            requireRecovery("투입된 지폐 금액을 확인하지 못했습니다. 추가 투입하지 말고 관리자에게 문의해주세요.")
            return
          }

          console.log("[v0] Polling: Re-enabling acceptance for next bill...")
          await new Promise((resolve) => setTimeout(resolve, 500))
          if (!await enableAcceptance()) throw new Error("Acceptor enable not confirmed")
          setStatusMessage(largeBillsOnly ? "1만원권 또는 5만원권을 추가로 투입해주세요..." : "추가 지폐를 투입해주세요...")

        } else if (status === 0x0c) {
          setIsProcessing(false)
          setError(largeBillsOnly
            ? "1천원권·5천원권이 감지되었거나 인식기 오류가 발생했습니다. 관리자에게 문의해주세요."
            : "지폐인식기 오류가 발생했습니다. 관리자에게 문의해주세요.")

        }
      } catch (e) {
        console.error("[v0] Polling error:", e)
        requireRecovery("현금 처리 결과를 확인하지 못했습니다. 추가 투입하지 말고 관리자에게 문의해주세요.")
      } finally {
        isPollingProcessingRef.current = false
      }
    },
    [addBill, requiredAmount, handlePaymentCompletion, largeBillsOnly, requireRecovery],
  )

  useEffect(() => {
    if (paymentMethod !== "cash") return

    let isMounted = true

    const initializePayment = async () => {
      setIsConnecting(true)
      setError("")

      try {
        if (!isBillAcceptorConnected()) {
          setStatusMessage("현금 결제를 준비하고 있습니다...")
          const connected = await connectBillAcceptor()
          if (!isMounted || cancellingRef.current) return

          if (!connected) {
            setError("현금 결제를 준비하지 못했습니다. 문의전화로 연락해주세요.")
            setIsConnecting(false)
            return
          }
        }

        if (!isMounted || cancellingRef.current) return
        console.log("[v0] Bill acceptor connected")
        setStatusMessage("지폐 투입구를 준비하고 있습니다...")
        acceptanceAttemptedRef.current = true
        if (!await enableAcceptance()) throw new Error("Acceptor enable not confirmed")
        // Cancellation drains this promise before stopping the acceptor. A late
        // enable acknowledgement must not start polling or reopen this flow.
        if (!isMounted || cancellingRef.current) return
        console.log("[v0] Bill acceptance enabled")

        setStatusMessage(largeBillsOnly ? "1만원권 또는 5만원권을 투입해주세요..." : "지폐를 투입해주세요...")
        setIsConnecting(false)
        setIsProcessing(true)

        if (isMounted && !cancellingRef.current) {
          console.log("[v0] Starting Polling Loop")
          pollingRef.current = setInterval(() => {
            if (!paymentCompleteRef.current) pollDeviceStatus()
          }, 500)
        }

      } catch (error) {
        if (isMounted) {
          console.error("[v0] Payment initialization error:", error)
          setError("현금 결제를 준비하지 못했습니다. 문의전화로 연락해주세요.")
          setIsConnecting(false)
        }
      }
    }

    const initialization = initializePayment()
    cashInitializationRef.current = initialization

    return () => {
      isMounted = false
      console.log("[v0] Cleaning up payment screen connection")
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      // Explicit cancellation/completion already confirmed shutdown. On other
      // exits, wait for enable to settle so the shared OK response cannot clash.
      if (acceptanceAttemptedRef.current) void initialization.then(() => setConfig(0x1c))
    }
  }, [paymentMethod, pollDeviceStatus, largeBillsOnly])

  const remainingAmount = requiredAmount - paymentSession.acceptedAmount

  const handleCancel = async () => {
    if (cancellingRef.current || paymentCompleteRef.current) return
    if (isPollingProcessingRef.current) {
      setError("지폐 확인 중입니다. 잠시 후 취소를 다시 눌러주세요.")
      return
    }

    cancellingRef.current = true
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    setIsCancelling(true)
    setStatusMessage("결제 취소 중...")

    try {
      // Enable, reset and config share one acknowledgement slot. Do not send a
      // stop while initialization owns it, even when no cash has been inserted.
      await cashInitializationRef.current
      // No enable command and no cash means there is no physical operation to reverse.
      if (!acceptanceAttemptedRef.current && latestSession.current.acceptedAmount === 0) {
        if (await cancelPayment()) onCancel()
        return
      }
      setEventCallback(null)
      console.log("[v0] Initializing bill acceptor for cancellation...")
      if (!await initializeDevice() || !await setConfig(0x1c)) throw new Error("Acceptor shutdown not confirmed")
      acceptanceAttemptedRef.current = false

      const acceptedAmount = latestSession.current.acceptedAmount
      if (acceptedAmount > 0) {
        setStatusMessage(`${acceptedAmount.toLocaleString()}원 반환 중...`)

        if (acceptedAmount % 10000 !== 0) {
          requireRecovery(`${acceptedAmount.toLocaleString()}원을 자동 반환할 수 없습니다. 관리자에게 문의해주세요.`)
          return
        }
        const billCount = acceptedAmount / 10000
        console.log(`[v0] Refunding ${billCount} bills of 10,000 won`)

        if (!isBillDispenserConnected() && !await connectBillDispenser()) throw new Error("Dispenser disconnected")
        const refunded = await dispenseBills(billCount)

        if (refunded) {
          recordCashReturned(acceptedAmount)
          console.log("[v0] Refund successful")
          setStatusMessage("환불 완료!")
          await new Promise((resolve) => setTimeout(resolve, 2000))
        } else {
          console.error("[v0] Refund failed")
          requireRecovery("환불 완료를 확인하지 못했습니다. 중복 반환하지 말고 관리자에게 문의해주세요.")
          return
        }
      }

      if (await cancelPayment()) onCancel()
    } catch (error) {
      console.error("[v0] Cancel error:", error)
      requireRecovery("결제 취소 및 반환 완료를 확인하지 못했습니다. 관리자에게 문의해주세요.")
    } finally {
      cancellingRef.current = false
      setIsCancelling(false)
    }
  }

  const changeCashMethod = async () => {
    if (cancellingRef.current || isPollingProcessingRef.current || latestSession.current.acceptedAmount > 0) return
    cancellingRef.current = true
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    try {
      await cashInitializationRef.current
      if (acceptanceAttemptedRef.current && !await setConfig(0x1c)) {
        requireRecovery("지폐 투입구 종료를 확인하지 못했습니다. 추가 결제하지 말고 관리자에게 문의해주세요.")
        return
      }
      acceptanceAttemptedRef.current = false
      setPaymentMethod("select")
    } catch {
      requireRecovery("지폐 투입구 종료를 확인하지 못했습니다. 관리자에게 문의해주세요.")
    } finally { cancellingRef.current = false }
  }

  const selectPaymentMethod = (method: "card" | "cash") => {
    const amount = method === "card" ? cardAmount : cashAmount
    if (amount <= 0) return
    if (!startPayment(amount, paymentSession.reservationData, method)) return
    setPaymentMethod(method)
  }

  if (paymentMethod === "select") {
    return (
      <main className="kiosk-payment-method-screen">
        <header>
          <p>선택한 객실</p>
          <h1>{title}</h1>
          <span>{description}</span>
        </header>

        <section className="kiosk-payment-methods" aria-label="결제 방법">
              <button
                type="button"
                onClick={() => selectPaymentMethod("card")}
                disabled={cardAmount <= 0}
                className="kiosk-payment-method is-card"
              >
                <CreditCard className="h-16 w-16" />
                <span>
                  <strong>카드 결제</strong>
                  <small>{cardAmount > 0 ? `${cardAmount.toLocaleString()}원` : "이용 불가"}</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => selectPaymentMethod("cash")}
                disabled={cashAmount <= 0}
                className="kiosk-payment-method is-cash"
              >
                <Banknote className="h-16 w-16" />
                <span>
                  <strong>현금 결제</strong>
                  <small>{cashAmount > 0 ? `${cashAmount.toLocaleString()}원` : "이용 불가"}</small>
                </span>
              </button>
        </section>

        <button type="button" className="kiosk-payment-back" onClick={onCancel}>
          이전 화면
        </button>
      </main>
    )
  }

  if (paymentMethod === "card") {
    return (
      <div className="flex h-full w-full items-start justify-start">
        <div className="kiosk-content-container">
          <div className="kiosk-payment-flow-header">
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="mt-8 w-full">
            <TossFrontCardPayment
              requiredAmount={requiredAmount}
              onComplete={onPaymentComplete}
              onBack={() => setPaymentMethod("select")}
              onCancel={onCancel}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div className="kiosk-payment-flow-header">
          <h1>{title}</h1>
          <p>{description}</p>
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
          <Button
            variant="ghost"
            onClick={changeCashMethod}
            disabled={isConnecting || paymentSession.acceptedAmount > 0}
            className="h-16 w-full text-xl"
          >
            결제수단 변경
          </Button>
        </div>
      </div>
    </div>
  )
}

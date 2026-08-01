"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, CreditCard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { CompletedPayment } from "@/lib/payment-types"

interface TossCardPaymentProps {
  requiredAmount: number
  building: string
  roomType: string
  stayType: "overnight" | "shortStay"
  onComplete: (payment: CompletedPayment) => void
  onBack: () => void
  onCancel: () => void
}

type PaymentState = "idle" | "creating" | "waiting" | "complete" | "error"

export default function TossCardPayment({
  requiredAmount,
  building,
  roomType,
  stayType,
  onComplete,
  onBack,
  onCancel,
}: TossCardPaymentProps) {
  const [state, setState] = useState<PaymentState>("idle")
  const [error, setError] = useState("")
  const [payToken, setPayToken] = useState("")
  const [orderNo, setOrderNo] = useState("")
  const popupRef = useRef<Window | null>(null)
  const pollingRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const checkPayment = useCallback(
    async (token: string, expectedOrderNo: string) => {
      if (completedRef.current) return

      try {
        const response = await fetch(`/api/toss-payments/status?payToken=${encodeURIComponent(token)}`, {
          cache: "no-store",
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "결제 상태를 확인하지 못했습니다.")

        if (result.payStatus === "PAY_COMPLETE") {
          if (result.orderNo !== expectedOrderNo || result.amount !== requiredAmount || result.payMethod !== "CARD") {
            throw new Error("결제 정보가 예약 내용과 일치하지 않습니다.")
          }

          completedRef.current = true
          stopPolling()
          popupRef.current?.close()
          setState("complete")
          window.setTimeout(
            () => onComplete({ method: "CARD", provider: "TOSS_PAY", payToken: token, orderNo: expectedOrderNo }),
            700,
          )
        } else if (result.payStatus === "PAY_CANCEL") {
          stopPolling()
          popupRef.current?.close()
          setState("idle")
          setError("카드 결제가 취소되었습니다. 다시 시도해주세요.")
        }
      } catch (statusError) {
        console.error("[Toss Pay] Polling error:", statusError)
      }
    },
    [onComplete, requiredAmount, stopPolling],
  )

  const startCardPayment = async () => {
    if (state === "creating" || state === "waiting") return

    setState("creating")
    setError("")
    try {
      const response = await fetch("/api/toss-payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building, roomType, stayType }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "카드 결제를 시작하지 못했습니다.")
      if (result.amount !== requiredAmount) throw new Error("서버 요금과 화면의 예약 금액이 일치하지 않습니다.")

      const popup = window.open(
        result.checkoutPage,
        "toss-card-payment",
        "popup=yes,width=520,height=760,center=yes,resizable=yes,scrollbars=yes",
      )
      if (!popup) throw new Error("결제창을 열 수 없습니다. 팝업 허용 설정을 확인해주세요.")

      popupRef.current = popup
      setPayToken(result.payToken)
      setOrderNo(result.orderNo)
      setState("waiting")

      await checkPayment(result.payToken, result.orderNo)
      pollingRef.current = window.setInterval(() => {
        void checkPayment(result.payToken, result.orderNo)
      }, 1500)
    } catch (startError) {
      console.error("[Toss Pay] Start error:", startError)
      setError(startError instanceof Error ? startError.message : "카드 결제를 시작하지 못했습니다.")
      setState("error")
    }
  }

  const cancel = () => {
    stopPolling()
    popupRef.current?.close()
    popupRef.current = null
    onCancel()
  }

  useEffect(() => {
    return () => {
      stopPolling()
      popupRef.current?.close()
    }
  }, [stopPolling])

  return (
    <div className="space-y-6">
      <Card className="shadow-lg">
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold">카드 결제 금액</span>
            <span className="text-4xl font-bold text-blue-700">{requiredAmount.toLocaleString()}원</span>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-md">
        <CardContent className="p-8 text-center">
          {state === "waiting" ? (
            <>
              <Loader2 className="mx-auto h-16 w-16 animate-spin text-blue-600" />
              <h2 className="mt-5 text-2xl font-bold">토스 결제창에서 카드 결제를 진행해주세요</h2>
              <p className="mt-3 text-lg text-slate-600">결제가 끝나면 키오스크가 자동으로 확인합니다.</p>
            </>
          ) : state === "complete" ? (
            <>
              <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
              <h2 className="mt-5 text-2xl font-bold text-green-700">카드 결제가 완료되었습니다</h2>
            </>
          ) : (
            <>
              <CreditCard className="mx-auto h-16 w-16 text-blue-700" />
              <h2 className="mt-5 text-2xl font-bold">토스페이에 등록된 카드로 결제합니다</h2>
              <p className="mt-3 text-lg text-slate-600">결제 버튼을 누르면 안전한 토스 결제창이 열립니다.</p>
              <Button
                onClick={startCardPayment}
                disabled={state === "creating"}
                className="mt-7 h-20 w-full text-2xl font-bold"
              >
                {state === "creating" ? (
                  <>
                    <Loader2 className="mr-3 h-7 w-7 animate-spin" />
                    결제창 여는 중...
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-3 h-7 w-7" />
                    카드 결제하기
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-3 rounded-lg bg-red-50 p-5 text-lg font-semibold text-red-700">
          <AlertCircle className="h-7 w-7 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={state === "creating" || state === "waiting" || state === "complete"}
          className="h-20 flex-1 text-2xl font-bold"
        >
          결제수단 변경
        </Button>
        <Button
          variant="outline"
          onClick={cancel}
          disabled={state === "complete"}
          className="h-20 flex-1 text-2xl font-bold"
        >
          예약 취소
        </Button>
      </div>

      {payToken && orderNo && (
        <p className="text-center text-sm text-slate-400">주문번호 {orderNo}</p>
      )}
    </div>
  )
}

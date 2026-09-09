"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, CreditCard, Loader2, RefreshCw, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { CompletedPayment, TossFrontPaymentProof } from "@/lib/payment-types"
import { usePayment } from "@/contexts/payment-context"

interface TossFrontCardPaymentProps {
  requiredAmount: number
  onComplete: (payment: CompletedPayment) => void
  onBack: () => void
  onCancel: () => void
}

type PaymentState = "idle" | "waiting" | "complete" | "error"

interface FrontStatus {
  configured: boolean
  connected: boolean
  authenticated: boolean
  url?: string
  error?: string
}

export default function TossFrontCardPayment({
  requiredAmount,
  onComplete,
  onBack,
  onCancel,
}: TossFrontCardPaymentProps) {
  const [state, setState] = useState<PaymentState>("idle")
  const [status, setStatus] = useState<FrontStatus>({
    configured: false,
    connected: false,
    authenticated: false,
  })
  const [error, setError] = useState("")
  const autoStartedRef = useRef(false)
  const requestInFlight = useRef(false)
  const { setCardInFlight, requireRecovery } = usePayment()

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.tossFront) {
      setStatus({ configured: false, connected: false, authenticated: false })
      setError("토스 프론트 결제는 키오스크 앱(Electron)에서만 사용할 수 있습니다.")
      return
    }
    try {
      const nextStatus = await window.electronAPI.tossFront.getStatus()
      setStatus(nextStatus)
      if (nextStatus.error) setError(nextStatus.error)
    } catch {
      setStatus({ configured: false, connected: false, authenticated: false })
      setError("카드 단말기 상태를 확인하지 못했습니다. 관리자에게 문의해주세요.")
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    return window.electronAPI?.tossFront?.onStatus((nextStatus: FrontStatus) => {
      setStatus(nextStatus)
      if (nextStatus.authenticated) setError("")
      else if (nextStatus.error) setError(nextStatus.error)
    })
  }, [refreshStatus])

  const reconnect = async () => {
    setError("")
    await window.electronAPI?.tossFront?.reconnect()
    window.setTimeout(() => void refreshStatus(), 500)
  }

  const startPayment = async () => {
    if (requestInFlight.current || state === "waiting" || state === "complete") return
    const front = window.electronAPI?.tossFront
    if (!front || !status.authenticated) {
      setError("토스 프론트 단말기가 연결되지 않았습니다.")
      return
    }

    if (!setCardInFlight(true)) return
    requestInFlight.current = true
    setState("waiting")
    setError("")
    try {
      const result = await front.requestPayment({ amount: requiredAmount })
      if (!result.success && result.notApproved === true) {
        // Only the bridge's authenticated no-approval result is safe to retry.
        if (!setCardInFlight(false)) return
        requestInFlight.current = false
        setState("error")
        setError(result.error || "카드 결제가 승인되지 않았습니다. 다시 시도하거나 결제수단을 변경해주세요.")
        return
      }
      if (!result.success || !result.payment) {
        throw new Error(result.error || "카드 결제가 완료되지 않았습니다.")
      }
      if (result.payment.amount !== requiredAmount) {
        requireRecovery("카드 승인 금액이 예약 금액과 다릅니다. 다시 결제하지 말고 관리자에게 문의해주세요.", {
          expectedAmount: requiredAmount,
          payment: { method: "CARD", provider: "TOSS_FRONT", front: result.payment },
        })
        return
      }

      setState("complete")
      onComplete({
            method: "CARD",
            provider: "TOSS_FRONT",
            front: result.payment as TossFrontPaymentProof,
          })
    } catch (paymentError) {
      setState("error")
      // IPC loss/timeout cannot prove that the terminal did not approve the card.
      requireRecovery(paymentError instanceof Error ? paymentError.message : "카드 승인 결과를 확인하지 못했습니다. 관리자에게 문의해주세요.")
    }
  }

  const ready = status.configured && status.connected && status.authenticated

  useEffect(() => {
    if (!ready || state !== "idle" || autoStartedRef.current) return
    autoStartedRef.current = true
    void startPayment()
  }, [ready, state])

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
              <h2 className="mt-5 text-2xl font-bold">카드 단말기에서 결제해주세요</h2>
              <p className="mt-3 text-lg text-slate-600">카드를 꽂거나 태그한 뒤 단말기 안내를 따라주세요.</p>
            </>
          ) : state === "complete" ? (
            <>
              <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
              <h2 className="mt-5 text-2xl font-bold text-green-700">카드 승인이 완료되었습니다</h2>
            </>
          ) : (
            <>
              {ready ? (
                <CreditCard className="mx-auto h-16 w-16 text-blue-700" />
              ) : (
                <WifiOff className="mx-auto h-16 w-16 text-red-600" />
              )}
              <h2 className="mt-5 text-2xl font-bold">
                {ready ? "카드 결제 준비" : "카드 단말기 연결을 확인해주세요"}
              </h2>
              <p className="mt-3 text-lg text-slate-600">
                {ready ? "카드를 꽂거나 태그해주세요." : "단말기 전원과 네트워크를 확인하세요."}
              </p>
              {ready ? (
                <Button onClick={startPayment} className="mt-7 h-20 w-full text-2xl font-bold">
                  <CreditCard className="mr-3 h-7 w-7" />
                  카드 결제 다시 시도
                </Button>
              ) : (
                <Button variant="outline" onClick={reconnect} className="mt-7 h-20 w-full text-2xl font-bold">
                  <RefreshCw className="mr-3 h-7 w-7" />
                  단말기 다시 연결
                </Button>
              )}
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
          disabled={state === "waiting" || state === "complete"}
          className="h-20 flex-1 text-2xl font-bold"
        >
          결제수단 변경
        </Button>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={state === "waiting" || state === "complete"}
          className="h-20 flex-1 text-2xl font-bold"
        >
          이전 화면
        </Button>
      </div>
    </div>
  )
}

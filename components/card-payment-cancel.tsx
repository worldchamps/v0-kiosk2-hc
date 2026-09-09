"use client"

import { useState, useEffect, useRef } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { TossFrontPaymentProof } from "@/lib/payment-types"

type PaymentClaim = TossFrontPaymentProof & {
  reservationId: string
  status: string
  canceledAt?: string
}
type PendingCancel = { reservationId: string; amount: number; cancelProof?: unknown; cancelApprovalNumber?: string }
const CANCEL_STORAGE_KEY = "kiosk-pending-card-cancel-v1"

export default function CardPaymentCancel() {
  const [reservationId, setReservationId] = useState("")
  const [payment, setPayment] = useState<PaymentClaim | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CANCEL_STORAGE_KEY)
      if (saved) {
        const pending = JSON.parse(saved)
        if (typeof pending.reservationId !== "string" || !Number.isFinite(pending.amount)) throw new Error("Invalid cancellation")
        setPendingCancel(pending)
        setReservationId(pending.reservationId)
        setMessage("이전 카드 취소 확인이 필요합니다. 카드 취소를 반복하지 마세요.")
      }
    } catch { setMessage("이전 취소 기록을 읽지 못했습니다. 관리자 확인이 필요합니다."); busyRef.current = true }
  }, [])

  const saveCancelRecord = async (pending: PendingCancel) => {
    if (!pending.cancelProof) throw new Error("단말기 취소 결과를 확인하지 못했습니다. 중복 취소하지 말고 관리자에게 문의해주세요.")
    const response = await fetch("/api/admin/payment-cancel", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending), signal: AbortSignal.timeout(30000),
    })
    const data = await response.json()
    if (!response.ok || data.success !== true) throw new Error(data.error || "카드 취소 기록 저장을 확인하지 못했습니다.")
    window.localStorage.removeItem(CANCEL_STORAGE_KEY)
    setPendingCancel(null)
    setPayment(previous => previous ? { ...previous, status: "canceled", canceledAt: new Date().toISOString() } : previous)
    setMessage(`${pending.amount.toLocaleString("ko-KR")}원 승인취소와 기록 저장이 완료되었습니다.`)
  }

  const retryRecord = async () => {
    if (!pendingCancel || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try { await saveCancelRecord(pendingCancel) }
    catch (error) { setMessage(error instanceof Error ? error.message : "취소 기록 저장에 실패했습니다.") }
    finally { busyRef.current = false; setBusy(false) }
  }

  const lookup = async () => {
    if (busyRef.current || pendingCancel) return
    const trimmedReservationId = reservationId.trim()
    if (!trimmedReservationId) {
      setMessage("예약번호를 입력해주세요.")
      return
    }

    busyRef.current = true
    setBusy(true)
    setPayment(null)
    setMessage("")
    try {
      const response = await fetch(
        `/api/admin/payment-cancel?reservationId=${encodeURIComponent(trimmedReservationId)}`,
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "결제 기록 조회에 실패했습니다.")
      setPayment(data.payment)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제 기록 조회에 실패했습니다.")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!payment || payment.status === "canceled" || pendingCancel || busyRef.current) return
    const tossFront = window.electronAPI?.tossFront
    if (!tossFront) {
      setMessage("카드 단말이 연결된 키오스크 앱에서만 취소할 수 있습니다.")
      return
    }

    busyRef.current = true
    setBusy(true)
    setMessage("")
    try {
      const pending: PendingCancel = { reservationId: payment.reservationId, amount: payment.amount }
      // Persist intent before the terminal operation. A lost response is not safe to repeat.
      window.localStorage.setItem(CANCEL_STORAGE_KEY, JSON.stringify(pending))
      setPendingCancel(pending)
      const result = await tossFront.cancelPayment(payment)
      if (!result.success) throw new Error(result.error || "카드 승인취소에 실패했습니다.")

      const cancelResult = result.cancel as { approvalNumber?: string; cancelProof?: unknown } | undefined
      pending.cancelApprovalNumber = cancelResult?.approvalNumber || ""
      pending.cancelProof = cancelResult?.cancelProof
      setPendingCancel(pending)
      window.localStorage.setItem(CANCEL_STORAGE_KEY, JSON.stringify(pending))
      await saveCancelRecord(pending)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "카드 승인취소에 실패했습니다.")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>카드 승인취소</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={reservationId}
            onChange={(event) => setReservationId(event.target.value)}
            placeholder="예: ONSITE-1786618230093"
            disabled={busy || !!pendingCancel}
          />
          <Button onClick={lookup} disabled={busy || !!pendingCancel}>
            조회
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">회색 글씨는 예시입니다. 예약번호를 직접 입력해주세요.</p>

        {payment && (
          <div className="space-y-3 rounded-lg border p-4">
            <p>결제금액: <strong>{payment.amount.toLocaleString("ko-KR")}원</strong></p>
            <p>승인번호: {payment.approvalNumber}</p>
            <p>카드번호: {payment.maskedCardNumber || "확인 불가"}</p>
            <p>상태: {payment.status === "canceled" ? "취소 완료" : "승인 완료"}</p>
            <Button variant="destructive" onClick={cancel} disabled={busy || !!pendingCancel || payment.status === "canceled"}>
              {busy ? "처리 중..." : "이 결제 승인취소"}
            </Button>
          </div>
        )}

        {pendingCancel && <div role="alert" className="space-y-3 rounded border p-4">
          <p>카드 취소 확인 대기: {pendingCancel.reservationId}. 새 취소 요청을 보내지 않습니다.</p>
          {pendingCancel.cancelProof ? <Button onClick={retryRecord} disabled={busy}>취소 기록 저장만 다시 시도</Button> :
            <p>단말기 취소 결과를 관리자와 확인해주세요.</p>}
        </div>}

        {message && (
          <Alert variant={message.includes("완료") ? "default" : "destructive"}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

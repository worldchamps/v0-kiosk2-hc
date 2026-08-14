"use client"

import { useState } from "react"
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

export default function CardPaymentCancel() {
  const [reservationId, setReservationId] = useState("")
  const [payment, setPayment] = useState<PaymentClaim | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  const lookup = async () => {
    const trimmedReservationId = reservationId.trim()
    if (!trimmedReservationId) {
      setMessage("예약번호를 입력해주세요.")
      return
    }

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
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!payment || payment.status === "canceled") return
    const tossFront = window.electronAPI?.tossFront
    if (!tossFront) {
      setMessage("카드 단말이 연결된 키오스크 앱에서만 취소할 수 있습니다.")
      return
    }

    setBusy(true)
    setMessage("")
    try {
      const result = await tossFront.cancelPayment(payment)
      if (!result.success) throw new Error(result.error || "카드 승인취소에 실패했습니다.")

      const cancelResult = result.cancel as { approvalNumber?: string } | undefined
      await fetch("/api/admin/payment-cancel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: payment.reservationId,
          cancelApprovalNumber: cancelResult?.approvalNumber || "",
        }),
      })
      setPayment({ ...payment, status: "canceled", canceledAt: new Date().toISOString() })
      setMessage(`${payment.amount.toLocaleString("ko-KR")}원 승인취소가 완료되었습니다.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "카드 승인취소에 실패했습니다.")
    } finally {
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
            disabled={busy}
          />
          <Button onClick={lookup} disabled={busy}>
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
            <Button variant="destructive" onClick={cancel} disabled={busy || payment.status === "canceled"}>
              {busy ? "처리 중..." : "이 결제 승인취소"}
            </Button>
          </div>
        )}

        {message && (
          <Alert variant={message.includes("완료") ? "default" : "destructive"}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

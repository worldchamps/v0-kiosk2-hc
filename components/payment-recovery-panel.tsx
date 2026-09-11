"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import AdminKeypad from "@/components/admin-keypad"
import { usePayment } from "@/contexts/payment-context"

export default function PaymentRecoveryPanel({ disabled = false, onResolved }: { disabled?: boolean; onResolved: () => void }) {
  const { paymentSession: session, storageError, resolveRecovery } = usePayment()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const zeroCash = !storageError && session.method === "cash" && session.acceptedAmount === 0 &&
    session.acceptedBills.length === 0 && !session.returnedAmount && !session.cardInFlight &&
    !session.recoveryEvidence && !session.pendingBooking
  const close = () => { if (!busyRef.current) { setOpen(false); setPassword(""); setConfirmed(false); setNote(""); setError("") } }
  const resolve = async () => {
    if (busyRef.current || disabled || !confirmed || !note || !password) return
    busyRef.current = true; setBusy(true); setError("")
    try {
      const result = await resolveRecovery(password, zeroCash && note === "현금 미투입 취소" ? "zero_cash" : "operator_resolved", note)
      if (!result.success) { setError(result.error || "복구를 완료하지 못했습니다."); return }
      setPassword(""); setOpen(false); onResolved()
    } catch { setError("복구 응답을 확인하지 못했습니다. 다시 결제하지 말고 복구를 다시 확인해주세요.") }
    finally { busyRef.current = false; setBusy(false) }
  }
  if (!open) return <Button variant="outline" className="h-20 w-full text-2xl" disabled={disabled} onClick={() => setOpen(true)}>관리자 복구</Button>
  if (!password) return <AdminKeypad showDevices={false} onClose={close} onConfirm={setPassword} verifyPassword={async value => {
    const result = await window.electronAPI?.paymentRecovery?.authorize(value)
    if (!result?.success) throw new Error(result?.error || "이 설치 버전에서는 관리자 복구를 사용할 수 없습니다.")
    return true
  }} />
  return <section role="dialog" aria-modal="true" aria-labelledby="payment-recovery-title"
    className="fixed inset-0 z-50 overflow-y-auto bg-white p-6 md:p-12">
    <div className="mx-auto max-w-3xl space-y-6 text-xl">
      <h2 id="payment-recovery-title" className="text-3xl font-bold">결제 잠금 관리자 복구</h2>
      <p>원래 기록을 암호화해 보관한 뒤 이 거래의 화면 잠금만 해제합니다. 카드 승인·취소·현금 반환·예약 취소는 실행하지 않습니다.</p>
      <div className="rounded-xl bg-slate-100 p-5 space-y-2">
        <p>결제 방식: {session.method === "cash" ? "현금" : session.method === "card" ? "카드" : "확인 필요"}</p>
        <p>기록 시작: {session.sessionStartTime ? new Date(session.sessionStartTime).toLocaleString("ko-KR") : "확인 필요"}</p>
        <p>화면에 기록된 남은 현금: {storageError ? "확인 필요" : `${session.acceptedAmount.toLocaleString()}원`}</p>
        <p>기록된 반환액: {storageError ? "확인 필요" : `${(session.returnedAmount || 0).toLocaleString()}원`}</p>
        {session.pendingBooking && <p className="break-all">예약 처리 확인번호: {session.pendingBooking.requestId}</p>}
        <p className="text-red-700">{storageError || session.recoveryRequired || "예약 처리 결과 확인 필요"}</p>
      </div>
      <fieldset className="space-y-3" disabled={busy || disabled}>
        <legend className="font-bold">확인한 실제 처리 결과</legend>
        {[...(zeroCash ? ["현금 미투입 취소"] : []), ...(!storageError && session.method === "card" && session.acceptedAmount === 0 ? ["승인 내역 없음 확인"] : []), "관리자 정산 완료"].map(value =>
          <label key={value} className="flex min-h-16 items-center gap-4 rounded-lg border p-4">
            <input type="radio" name="recovery-result" value={value} checked={note === value} onChange={() => { setNote(value); setConfirmed(false) }} className="h-6 w-6" />{value}
          </label>)}
        <label className="flex items-start gap-4 rounded-lg bg-amber-50 p-5">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
          <span>{zeroCash && note === "현금 미투입 취소" ? "현금을 넣지 않았고 진행 중인 고객 거래가 없음을 확인했습니다." :
            "단말기 승인·취소 내역, 실제 투입·반환 현금과 예약 처리 결과를 확인했고 미처리 금액이 없음을 확인했습니다."}</span>
        </label>
      </fieldset>
      <p className="text-base text-slate-600">현금 관련 건은 투입구 정지 응답도 다시 확인합니다. 정지나 기록 보관에 실패하면 거래 기록과 잠금을 유지하며 여기서 다시 확인할 수 있습니다.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
      <div className="flex gap-4">
        <Button variant="outline" className="h-20 flex-1 text-xl" onClick={close} disabled={busy}>돌아가기</Button>
        <Button className="h-20 flex-[2] text-xl" onClick={resolve} disabled={busy || disabled || !confirmed || !note}>
          {busy ? "정지 확인 및 기록 보관 중..." : "기록 보관 후 처음으로"}
        </Button>
      </div>
    </div>
  </section>
}

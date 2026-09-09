import { type NextRequest, NextResponse } from "next/server"
import { findTossFrontPaymentClaim, markTossFrontPaymentCanceled } from "@/lib/firebase-admin"
import { getKioskScope, isRoomInBuilding } from "@/lib/kiosk-scope"
import { getPropertyFromRoomNumber } from "@/lib/property-utils"
import { verifyTossFrontCancellationProof } from "@/lib/toss-front"
import { bookingHash, readOnSiteBooking } from "@/lib/on-site-bookings"

const RESERVATION_ID_PATTERN = /^ONSITE-(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

async function scopedPayment(reservationId: unknown) {
  if (typeof reservationId !== "string" || !RESERVATION_ID_PATTERN.test(reservationId)) {
    return { response: NextResponse.json({ error: "현장 예약번호를 확인해주세요." }, { status: 400 }) }
  }
  const scope = getKioskScope()
  const payment = await findTossFrontPaymentClaim(reservationId)
  if (!payment) return { response: NextResponse.json({ error: "해당 예약의 카드 결제 기록을 찾지 못했습니다." }, { status: 404 }) }
  if (typeof payment.roomCode !== "string" || getPropertyFromRoomNumber(payment.roomCode) !== scope.property ||
      !isRoomInBuilding(payment.roomCode, scope.building)) {
    return { response: NextResponse.json({ error: "이 키오스크에서 처리할 수 없는 객실의 결제입니다." }, { status: 403 }) }
  }
  return { payment }
}

export async function GET(request: NextRequest) {
  try {
    const result = await scopedPayment(new URL(request.url).searchParams.get("reservationId")?.trim())
    if (result.response) return result.response
    const booking = await readOnSiteBooking(bookingHash("toss_front:" + result.payment!.paymentKey))
    if (booking && ["preparing", "saving", "saved", "committing"].includes(booking.state)) {
      return NextResponse.json({ error: "예약 저장 결과를 확인 중인 결제입니다. 카드 취소를 시작하지 말고 예약 처리 결과를 먼저 확인해주세요." }, { status: 409 })
    }
    return NextResponse.json({ payment: result.payment })
  } catch {
    return NextResponse.json({ error: "결제 기록을 확인하지 못했습니다. 잠시 후 다시 조회해주세요." }, { status: 503 })
  }
}

export async function PATCH(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "올바른 카드 취소 기록 요청이 필요합니다." }, { status: 400 })
  }
  try {
    const result = await scopedPayment(body?.reservationId)
    if (result.response) return result.response
    const payment = result.payment!
    let proof
    try { proof = verifyTossFrontCancellationProof(body?.cancelProof, payment) } catch {
      return NextResponse.json({ error: "단말기가 서명한 카드 취소 확인 정보가 필요합니다. 카드 취소를 반복하지 말고 기록 저장을 다시 시도해주세요." }, { status: 400 })
    }
    if (payment.status === "canceled") {
      if (payment.cancelApprovalNumber !== proof.cancelApprovalNumber) {
        return NextResponse.json({ error: "이미 기록된 취소 정보와 다릅니다. 관리자에게 확인해주세요." }, { status: 409 })
      }
      return NextResponse.json({ success: true, alreadyRecorded: true })
    }
    if (payment.status !== "claimed") {
      return NextResponse.json({ error: "취소 기록을 저장할 수 없는 결제 상태입니다." }, { status: 409 })
    }
    const updated = await markTossFrontPaymentCanceled(body.reservationId, proof.cancelApprovalNumber)
    return updated ? NextResponse.json({ success: true }) :
      NextResponse.json({ error: "결제 기록을 찾지 못했습니다. 카드 취소를 반복하지 말고 관리자에게 확인해주세요." }, { status: 404 })
  } catch {
    return NextResponse.json({ error: "카드 취소 기록 저장을 확인하지 못했습니다. 카드 취소를 반복하지 말고 기록 저장만 다시 시도해주세요." }, { status: 503 })
  }
}

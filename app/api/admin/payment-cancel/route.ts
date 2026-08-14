import { type NextRequest, NextResponse } from "next/server"
import { findTossFrontPaymentClaim, markTossFrontPaymentCanceled } from "@/lib/firebase-admin"

const RESERVATION_ID_PATTERN = /^ONSITE-\d+$/

export async function GET(request: NextRequest) {
  const reservationId = new URL(request.url).searchParams.get("reservationId")?.trim() || ""
  if (!RESERVATION_ID_PATTERN.test(reservationId)) {
    return NextResponse.json({ error: "현장 예약번호를 확인해주세요." }, { status: 400 })
  }

  const payment = await findTossFrontPaymentClaim(reservationId)
  if (!payment) {
    return NextResponse.json({ error: "해당 예약의 카드 결제 기록을 찾지 못했습니다." }, { status: 404 })
  }
  return NextResponse.json({ payment })
}

export async function PATCH(request: NextRequest) {
  const { reservationId, cancelApprovalNumber } = await request.json()
  if (!RESERVATION_ID_PATTERN.test(reservationId || "")) {
    return NextResponse.json({ error: "현장 예약번호를 확인해주세요." }, { status: 400 })
  }

  const updated = await markTossFrontPaymentCanceled(reservationId, cancelApprovalNumber)
  return updated
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "결제 기록을 찾지 못했습니다." }, { status: 404 })
}

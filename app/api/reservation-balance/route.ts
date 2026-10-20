import { NextResponse } from "next/server"
import { pmsFetch, pmsKioskConfig } from "@/lib/pms-kiosk"
import { getDB } from "@/lib/firebase-admin"

export async function GET(request: Request) {
  const reservationId = new URL(request.url).searchParams.get("reservationId")
  if (!reservationId?.trim() || reservationId.length > 200) {
    return NextResponse.json({ error: "예약번호가 올바르지 않습니다." }, { status: 400 })
  }
  if (!pmsKioskConfig()) return NextResponse.json({ configured: false })
  try {
    const response = await pmsFetch(`/api/kiosk/balance?reservationId=${encodeURIComponent(reservationId)}`, { method: "GET" }, 8000)
    if (!response.ok) throw new Error("Balance unavailable")
    const data = await response.json()
    if (!data || data.reservationId !== reservationId || typeof data.payable !== "boolean" ||
        [data.price, data.collected, data.remaining].some(value => !Number.isSafeInteger(value) || value < 0) ||
        (data.reason !== undefined && (typeof data.reason !== "string" || data.reason.length > 200))) {
      throw new Error("Invalid balance")
    }
    if (data.payable) {
      const database = getDB()
      const claimKey = (await database.ref(`payment_claims_by_reservation/toss_front/${reservationId}`).once("value")).val()
      if (claimKey !== null) {
        if (typeof claimKey !== "string" || !/^[a-f0-9]{64}$/.test(claimKey)) throw new Error("Invalid payment claim index")
        const claim = (await database.ref(`payment_claims/toss_front/${claimKey}`).once("value")).val()
        if (claim?.purpose === "collection") {
          data.payable = false
          data.reason = "kiosk_payment_unresolved"
        }
      }
    }
    return NextResponse.json({
      configured: true, payable: data.payable, remaining: data.remaining,
      collected: data.collected, price: data.price, reason: data.reason,
    })
  } catch {
    return NextResponse.json({ error: "결제 금액을 확인하지 못했습니다." }, { status: 503 })
  }
}

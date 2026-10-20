import { NextResponse } from "next/server"
import { pmsFetch, pmsKioskConfig } from "@/lib/pms-kiosk"

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
    return NextResponse.json({
      configured: true, payable: data.payable, remaining: data.remaining,
      collected: data.collected, price: data.price, reason: data.reason,
    })
  } catch {
    return NextResponse.json({ error: "결제 금액을 확인하지 못했습니다." }, { status: 503 })
  }
}

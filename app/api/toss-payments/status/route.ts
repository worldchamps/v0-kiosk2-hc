import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getTossPaymentStatus } from "@/lib/toss-pay"

export async function GET(request: NextRequest) {
  const payToken = request.nextUrl.searchParams.get("payToken")
  if (!payToken) {
    return NextResponse.json({ error: "payToken이 필요합니다." }, { status: 400 })
  }

  try {
    const payment = await getTossPaymentStatus(payToken)
    return NextResponse.json({
      success: true,
      payStatus: payment.payStatus,
      payMethod: payment.payMethod,
      orderNo: payment.orderNo,
      amount: payment.amount,
    })
  } catch (error) {
    console.error("[Toss Pay] Status lookup failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "결제 상태를 확인하지 못했습니다." },
      { status: 502 },
    )
  }
}

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyCompletedCardPayment } from "@/lib/toss-pay"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (
      body.status !== "PAY_COMPLETE" ||
      !body.payToken ||
      !body.orderNo ||
      !Number.isFinite(Number(body.amount))
    ) {
      return NextResponse.json({ error: "잘못된 결제 콜백입니다." }, { status: 400 })
    }

    await verifyCompletedCardPayment({
      payToken: body.payToken,
      orderNo: body.orderNo,
      expectedAmount: Number(body.amount),
    })

    console.info("[Toss Pay] Verified payment callback:", {
      orderNo: body.orderNo,
      payToken: body.payToken,
      amount: body.amount,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Toss Pay] Callback verification failed:", error)
    return NextResponse.json({ error: "결제 콜백 검증에 실패했습니다." }, { status: 400 })
  }
}

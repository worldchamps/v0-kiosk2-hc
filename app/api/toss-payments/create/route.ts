import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getOnSiteRate } from "@/lib/on-site-pricing"
import { createTossPayment } from "@/lib/toss-pay"

function getPublicBaseUrl(request: NextRequest) {
  const configured = process.env.TOSS_PAY_PUBLIC_BASE_URL?.trim().replace(/\/$/, "")
  if (configured) {
    const url = new URL(configured)
    if (url.protocol !== "https:") {
      throw new Error("TOSS_PAY_PUBLIC_BASE_URL은 https:// 주소여야 합니다.")
    }
    return url.origin
  }

  if (process.env.NODE_ENV !== "production") {
    return request.nextUrl.origin
  }

  throw new Error("TOSS_PAY_PUBLIC_BASE_URL 환경변수가 설정되지 않았습니다.")
}

export async function POST(request: NextRequest) {
  try {
    const { building, roomType, stayType } = await request.json()
    if (!building || !roomType || (stayType !== "overnight" && stayType !== "shortStay")) {
      return NextResponse.json({ error: "결제 상품 정보가 올바르지 않습니다." }, { status: 400 })
    }

    const amount = getOnSiteRate(building, roomType, stayType)
    if (!amount) {
      return NextResponse.json({ error: "예약 요금을 확인할 수 없습니다." }, { status: 400 })
    }

    const orderNo = `KIOSK-${Date.now()}-${randomUUID().slice(0, 8)}`
    const publicBaseUrl = getPublicBaseUrl(request)
    const payment = await createTossPayment({
      orderNo,
      amount,
      productDesc: `더 비치스테이 ${stayType === "overnight" ? "숙박" : "대실"} (${roomType})`,
      resultCallback: `${publicBaseUrl}/api/toss-payments/callback`,
      retUrl: `${publicBaseUrl}/payments/toss/complete`,
      retCancelUrl: `${publicBaseUrl}/payments/toss/cancel`,
    })

    return NextResponse.json({
      success: true,
      orderNo,
      amount,
      payToken: payment.payToken,
      checkoutPage: payment.checkoutPage,
    })
  } catch (error) {
    console.error("[Toss Pay] Payment creation failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "카드 결제를 시작하지 못했습니다." },
      { status: 502 },
    )
  }
}

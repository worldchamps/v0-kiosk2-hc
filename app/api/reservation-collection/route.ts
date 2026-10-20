import { NextResponse } from "next/server"
import { claimPayment, getPaymentClaim } from "@/lib/firebase-admin"
import { verifyTossFrontPaymentProof } from "@/lib/toss-front"
import { pmsFetch, pmsKioskConfig } from "@/lib/pms-kiosk"
import { collectionPaidAt, isCollectionRecorded } from "@/lib/reservation-collection"

export async function POST(request: Request) {
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ status: "error" }, { status: 400 })
  }
  const { requestId, reservationId, expectedCollected, amount, paidAt, payment } = body || {}
  if (typeof reservationId !== "string" || !reservationId.trim() || reservationId.length > 200 ||
      typeof requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,300}$/.test(requestId) ||
      !Number.isSafeInteger(amount) || amount <= 0 ||
      !Number.isSafeInteger(expectedCollected) || expectedCollected < 0 ||
      typeof paidAt !== "string" || !Number.isFinite(Date.parse(paidAt)) ||
      new Date(paidAt).toISOString() !== paidAt || !["CARD", "CASH"].includes(payment?.method)) {
    return NextResponse.json({ status: "error" }, { status: 400 })
  }
  try {
    if (payment.method === "CARD") {
      if (payment.provider !== "TOSS_FRONT" || requestId !== payment.front?.paymentKey) throw new Error("Invalid card identity")
      verifyTossFrontPaymentProof(payment.front, amount)
      const submittedAt = Date.parse(paidAt)
      // Use the original fallback time when verifying a retried, signed approval.
      if (submittedAt < Date.UTC(2020, 0, 1) || submittedAt > Date.now() + 86400000 ||
          collectionPaidAt(payment.front.timestamp, submittedAt) !== paidAt) throw new Error("Invalid approval time")
    } else if (!/^cash-[0-9a-f-]{36}$/.test(requestId)) throw new Error("Invalid cash identity")
  } catch {
    return NextResponse.json({ status: "error" }, { status: 400 })
  }
  const config = pmsKioskConfig()
  if (!config) return NextResponse.json({ status: "error" }, { status: 503 })
  try {
    if (payment.method === "CARD" &&
        !await claimPayment("toss_front", requestId, { reservationId, amount, purpose: "collection" })) {
      const claim: { reservationId?: string; purpose?: string; amount?: number } | null = await getPaymentClaim("toss_front", requestId)
      if (!claim || claim.reservationId !== reservationId || claim.purpose !== "collection" || claim.amount !== amount) {
        return NextResponse.json({ status: "conflict" }, { status: 409 })
      }
    }
    const response = await pmsFetch("/api/kiosk/collections", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId, expectedCollected, amount, method: payment.method === "CARD" ? "카드" : "현금",
        paymentKey: requestId, kioskId: config.kioskId, paidAt }),
    }, 10000)
    if (response.status >= 500) throw new Error("PMS collection unavailable")
    const result = await response.json()
    if (!["recorded", "duplicate", "stale", "not_payable", "conflict", "error", "in_progress", "amount_mismatch", "uncertain"].includes(result?.status) ||
        isCollectionRecorded(result.status) && (!response.ok || result.reservationId !== reservationId)) {
      throw new Error("Invalid collection response")
    }
    return NextResponse.json({ status: result.status, reservationId }, { status: response.status })
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 })
  }
}

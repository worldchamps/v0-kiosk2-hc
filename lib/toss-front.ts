import { createHmac, timingSafeEqual } from "crypto"
import type { TossFrontPaymentProof } from "@/lib/payment-types"

export function getTossFrontProofPayload(payment: Omit<TossFrontPaymentProof, "signature">) {
  return JSON.stringify({
    paymentKey: payment.paymentKey,
    amount: payment.amount,
    tax: payment.tax,
    supplyValue: payment.supplyValue,
    paymentMethod: payment.paymentMethod,
    tid: payment.tid,
    approvalNumber: payment.approvalNumber,
    timestamp: payment.timestamp,
    installment: payment.installment,
    vanTransactionManagementId: payment.vanTransactionManagementId,
  })
}

function getPairingKey() {
  const key = process.env.TOSS_FRONT_PAIRING_KEY?.trim()
  if (!key) {
    throw new Error("TOSS_FRONT_PAIRING_KEY 환경변수가 설정되지 않았습니다.")
  }
  return key
}

export function verifyTossFrontPaymentProof(proof: TossFrontPaymentProof, expectedAmount: number) {
  if (!proof || !["CARD", "BARCODE"].includes(proof.paymentMethod)) {
    throw new Error("토스 프론트 카드 결제 정보가 올바르지 않습니다.")
  }
  const missingFields = [
    !proof.paymentKey && "paymentKey",
    !proof.approvalNumber && "approvalNumber",
    !proof.timestamp && "timestamp",
  ].filter(Boolean)

  if (missingFields.length > 0) {
    throw new Error(`토스 프론트 승인 정보가 누락되었습니다: ${missingFields.join(", ")}`)
  }
  if (proof.amount !== expectedAmount || proof.tax + proof.supplyValue !== expectedAmount) {
    throw new Error("토스 프론트 결제 금액이 예약 금액과 일치하지 않습니다.")
  }

  const { signature, ...unsignedProof } = proof
  const expectedSignature = createHmac("sha256", getPairingKey())
    .update(getTossFrontProofPayload(unsignedProof))
    .digest("hex")

  const actual = Buffer.from(signature || "", "hex")
  const expected = Buffer.from(expectedSignature, "hex")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("토스 프론트 결제 서명을 확인할 수 없습니다.")
  }

  return proof
}

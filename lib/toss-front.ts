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

export interface TossFrontCancellationProof {
  operation: "toss-front-cancel"
  paymentKey: string
  amount: number
  cancelApprovalNumber: string
  timestamp: number
  signature: string
}

export function verifyTossFrontCancellationProof(proof: TossFrontCancellationProof, payment: { paymentKey: string; amount: number }) {
  if (!proof || proof.operation !== "toss-front-cancel" || proof.paymentKey !== payment.paymentKey ||
      proof.amount !== payment.amount || !Number.isSafeInteger(proof.amount) || proof.amount <= 0 ||
      typeof proof.cancelApprovalNumber !== "string" || proof.cancelApprovalNumber.length > 100 ||
      !Number.isFinite(proof.timestamp) || proof.timestamp <= 0 || proof.timestamp > Date.now() + 60000 ||
      typeof proof.signature !== "string" || !/^[a-f0-9]{64}$/i.test(proof.signature)) {
    throw new Error("단말기의 카드 취소 확인 정보가 올바르지 않습니다.")
  }
  const payload = JSON.stringify({ operation: proof.operation, paymentKey: proof.paymentKey,
    amount: proof.amount, cancelApprovalNumber: proof.cancelApprovalNumber, timestamp: proof.timestamp })
  const expected = createHmac("sha256", getPairingKey()).update(payload).digest()
  if (!timingSafeEqual(Buffer.from(proof.signature, "hex"), expected)) {
    throw new Error("카드 취소 확인 서명이 일치하지 않습니다.")
  }
  // No short expiry: a genuine cancellation may need its DB record retried after an outage.
  // It is bound to the original payment, and recording the same cancellation is idempotent.
  return proof
}

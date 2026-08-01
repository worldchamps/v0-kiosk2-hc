export interface TossFrontPaymentProof {
  paymentKey: string
  amount: number
  tax: number
  supplyValue: number
  paymentMethod: "CARD" | "CASH" | "BARCODE"
  tid: string
  approvalNumber: string
  timestamp: number
  installment: number
  issuerName?: string
  maskedCardNumber?: string
  van?: string
  vanTransactionManagementId?: string
  signature: string
}

export interface CompletedPayment {
  method: "CASH" | "CARD"
  provider?: "TOSS_PAY" | "TOSS_FRONT"
  payToken?: string
  orderNo?: string
  front?: TossFrontPaymentProof
}

const TOSS_PAY_API_BASE = "https://pay.toss.im/api/v2"
const PUBLIC_TEST_API_KEY = "sk_test_w5lNQylNqa5lNQe013Nq"

export interface TossPaymentStatus {
  code?: number
  msg?: string
  errorCode?: string
  mode?: "TEST" | "LIVE"
  payToken: string
  orderNo: string
  payStatus: string
  payMethod?: string
  amount: number
  paidAmount?: number
}

export function getTossPayApiKey() {
  const configuredKey = process.env.TOSS_PAY_API_KEY?.trim()
  if (configuredKey) return configuredKey

  if (process.env.NODE_ENV !== "production") {
    return PUBLIC_TEST_API_KEY
  }

  throw new Error("TOSS_PAY_API_KEY 환경변수가 설정되지 않았습니다.")
}

async function requestToss<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TOSS_PAY_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  const payload = (await response.json().catch(() => null)) as (T & {
    code?: number
    msg?: string
    errorCode?: string
  }) | null

  if (!response.ok || !payload || (typeof payload.code === "number" && payload.code !== 0)) {
    const message = payload?.msg || payload?.errorCode || `토스페이 API 오류 (${response.status})`
    throw new Error(message)
  }

  return payload
}

export function createTossPayment(input: {
  orderNo: string
  amount: number
  productDesc: string
  resultCallback: string
  retUrl: string
  retCancelUrl: string
}) {
  return requestToss<{
    code: number
    payToken: string
    checkoutPage: string
    status: number
  }>("/payments", {
    ...input,
    amountTaxFree: 0,
    apiKey: getTossPayApiKey(),
    autoExecute: true,
    enablePayMethods: "CARD",
    callbackVersion: "V2",
  })
}

export function getTossPaymentStatus(payToken: string) {
  return requestToss<TossPaymentStatus>("/status", {
    apiKey: getTossPayApiKey(),
    payToken,
  })
}

export async function verifyCompletedCardPayment(input: {
  payToken: string
  orderNo: string
  expectedAmount: number
}) {
  const status = await getTossPaymentStatus(input.payToken)

  if (status.payStatus !== "PAY_COMPLETE") {
    throw new Error(`결제가 완료되지 않았습니다. (${status.payStatus})`)
  }
  if (status.orderNo !== input.orderNo) {
    throw new Error("결제 주문번호가 일치하지 않습니다.")
  }
  if (status.amount !== input.expectedAmount) {
    throw new Error("결제 금액이 예약 금액과 일치하지 않습니다.")
  }
  if (status.payMethod !== "CARD") {
    throw new Error("카드 결제 내역이 아닙니다.")
  }

  return status
}

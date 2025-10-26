"use client"

import type React from "react"
import { createContext, useContext, useState, useCallback, useRef } from "react"
import { dispenseBills } from "@/lib/bill-dispenser-utils"

// 결제 세션 상태 타입
export interface PaymentSession {
  isActive: boolean // 결제 진행 중 여부
  acceptedAmount: number // 현재까지 받은 금액
  requiredAmount: number // 필요한 금액
  acceptedBills: number[] // 받은 지폐 목록 (1000, 5000, 10000, 50000)
  sessionStartTime: number // 세션 시작 시간
  reservationData?: any // 예약 정보 (현장예약용)
  overpaymentAmount: number // 초과 지불 금액
}

interface PaymentContextType {
  paymentSession: PaymentSession
  startPayment: (requiredAmount: number, reservationData?: any) => void
  addBill: (amount: number) => void
  completePayment: () => void
  cancelPayment: () => Promise<void>
  isPaymentComplete: () => boolean
  refundChange: () => Promise<boolean>
}

const PaymentContext = createContext<PaymentContextType | undefined>(undefined)

const initialSession: PaymentSession = {
  isActive: false,
  acceptedAmount: 0,
  requiredAmount: 0,
  acceptedBills: [],
  sessionStartTime: 0,
  overpaymentAmount: 0,
}

export function PaymentProvider({ children }: { children: React.ReactNode }) {
  const [paymentSession, setPaymentSession] = useState<PaymentSession>(initialSession)
  const refundInProgressRef = useRef(false)

  // 결제 시작
  const startPayment = useCallback((requiredAmount: number, reservationData?: any) => {
    console.log("[v0] Payment session started:", { requiredAmount, reservationData })
    setPaymentSession({
      isActive: true,
      acceptedAmount: 0,
      requiredAmount,
      acceptedBills: [],
      sessionStartTime: Date.now(),
      reservationData,
      overpaymentAmount: 0,
    })
  }, [])

  // 지폐 추가
  const addBill = useCallback((amount: number) => {
    setPaymentSession((prev) => {
      if (!prev.isActive) return prev

      const newAcceptedAmount = prev.acceptedAmount + amount
      const newAcceptedBills = [...prev.acceptedBills, amount]

      const overpayment = Math.max(0, newAcceptedAmount - prev.requiredAmount)

      console.log("[v0] Bill added:", {
        amount,
        newAcceptedAmount,
        requiredAmount: prev.requiredAmount,
        overpayment,
      })

      return {
        ...prev,
        acceptedAmount: newAcceptedAmount,
        acceptedBills: newAcceptedBills,
        overpaymentAmount: overpayment,
      }
    })
  }, [])

  const refundChange = useCallback(async (): Promise<boolean> => {
    const overpayment = paymentSession.overpaymentAmount

    if (overpayment === 0) {
      console.log("[v0] No overpayment to refund")
      return true
    }

    // 1만원 단위로 나누어떨어지지 않으면 오류
    if (overpayment % 10000 !== 0) {
      console.error("[v0] Overpayment is not a multiple of 10,000 won:", overpayment)
      return false
    }

    const billCount = overpayment / 10000
    console.log(`[v0] Refunding ${overpayment}원 (${billCount}장의 1만원권)`)

    try {
      // 1만원권 방출
      const success = await dispenseBills(billCount)

      if (!success) {
        console.error("[v0] Failed to dispense change")
        return false
      }

      console.log("[v0] Change refunded successfully")
      return true
    } catch (error) {
      console.error("[v0] Error during change refund:", error)
      return false
    }
  }, [paymentSession.overpaymentAmount])

  // 결제 완료
  const completePayment = useCallback(() => {
    console.log("[v0] Payment session reset")
    setPaymentSession(initialSession)
  }, [])

  // 결제 취소 및 환불
  const cancelPayment = useCallback(async () => {
    if (refundInProgressRef.current) {
      console.log("[v0] Refund already in progress, skipping")
      return
    }

    const currentSession = paymentSession

    if (!currentSession.isActive) {
      console.log("[v0] No active payment session")
      setPaymentSession(initialSession)
      return
    }

    refundInProgressRef.current = true
    console.log("[v0] Cancelling payment session:", {
      acceptedAmount: currentSession.acceptedAmount,
      acceptedBills: currentSession.acceptedBills,
    })

    try {
      // Note: The actual refund (dispensing bills) is handled by the payment screen
      // This function just resets the payment session
      console.log("[v0] Payment session cancelled")
    } catch (error) {
      console.error("[v0] Error during cancellation:", error)
    } finally {
      refundInProgressRef.current = false
      setPaymentSession(initialSession)
    }
  }, [paymentSession])

  // 결제 완료 여부 확인
  const isPaymentComplete = useCallback(() => {
    return paymentSession.isActive && paymentSession.acceptedAmount >= paymentSession.requiredAmount
  }, [paymentSession])

  return (
    <PaymentContext.Provider
      value={{
        paymentSession,
        startPayment,
        addBill,
        completePayment,
        cancelPayment,
        isPaymentComplete,
        refundChange,
      }}
    >
      {children}
    </PaymentContext.Provider>
  )
}

export function usePayment() {
  const context = useContext(PaymentContext)
  if (context === undefined) {
    throw new Error("usePayment must be used within a PaymentProvider")
  }
  return context
}

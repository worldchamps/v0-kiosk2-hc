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
}

interface PaymentContextType {
  paymentSession: PaymentSession
  startPayment: (requiredAmount: number, reservationData?: any) => void
  addBill: (amount: number) => void
  completePayment: () => void
  cancelPayment: () => Promise<void>
  isPaymentComplete: () => boolean
}

const PaymentContext = createContext<PaymentContextType | undefined>(undefined)

const initialSession: PaymentSession = {
  isActive: false,
  acceptedAmount: 0,
  requiredAmount: 0,
  acceptedBills: [],
  sessionStartTime: 0,
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
    })
  }, [])

  // 지폐 추가
  const addBill = useCallback((amount: number) => {
    setPaymentSession((prev) => {
      if (!prev.isActive) return prev

      const newAcceptedAmount = prev.acceptedAmount + amount
      const newAcceptedBills = [...prev.acceptedBills, amount]

      console.log("[v0] Bill added:", { amount, newAcceptedAmount, requiredAmount: prev.requiredAmount })

      return {
        ...prev,
        acceptedAmount: newAcceptedAmount,
        acceptedBills: newAcceptedBills,
      }
    })
  }, [])

  // 결제 완료
  const completePayment = useCallback(() => {
    console.log("[v0] Payment completed")
    setPaymentSession(initialSession)
  }, [])

  // 결제 취소 및 환불
  const cancelPayment = useCallback(async () => {
    if (refundInProgressRef.current) {
      console.log("[v0] Refund already in progress, skipping")
      return
    }

    const currentSession = paymentSession

    if (!currentSession.isActive || currentSession.acceptedAmount === 0) {
      console.log("[v0] No active payment or no bills to refund")
      setPaymentSession(initialSession)
      return
    }

    refundInProgressRef.current = true
    console.log("[v0] Starting refund process:", {
      acceptedAmount: currentSession.acceptedAmount,
      acceptedBills: currentSession.acceptedBills,
    })

    try {
      // 받은 지폐를 종류별로 그룹화
      const billCounts: { [key: number]: number } = {}
      for (const bill of currentSession.acceptedBills) {
        billCounts[bill] = (billCounts[bill] || 0) + 1
      }

      console.log("[v0] Bill counts for refund:", billCounts)

      // 각 지폐 종류별로 방출
      for (const [billAmount, count] of Object.entries(billCounts)) {
        const amount = Number.parseInt(billAmount)
        console.log(`[v0] Dispensing ${count}x ${amount}원 bills`)

        // 지폐 방출기로 환불 명령
        const success = await dispenseBills(count)

        if (!success) {
          console.error(`[v0] Failed to dispense ${count}x ${amount}원 bills`)
          // 환불 실패 시에도 계속 진행 (다른 지폐라도 환불 시도)
        } else {
          console.log(`[v0] Successfully dispensed ${count}x ${amount}원 bills`)
        }

        // 각 방출 사이에 약간의 지연
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      console.log("[v0] Refund process completed")
    } catch (error) {
      console.error("[v0] Error during refund:", error)
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

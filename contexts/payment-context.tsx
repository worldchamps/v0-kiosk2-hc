"use client"

import type React from "react"
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import type { CompletedPayment } from "@/lib/payment-types"

export interface PendingBooking {
  requestId: string
  body: string
  cancellationStarted?: boolean
}

export interface PaymentSession {
  isActive: boolean
  acceptedAmount: number
  requiredAmount: number
  acceptedBills: number[]
  sessionStartTime: number
  reservationData?: any
  overpaymentAmount: number
  returnedAmount?: number
  method?: "cash" | "card"
  cardInFlight?: boolean
  recoveryRequired?: string
  recoveryEvidence?: { expectedAmount: number; payment: CompletedPayment }
  pendingBooking?: PendingBooking
}

interface PaymentContextType {
  paymentSession: PaymentSession
  ready: boolean
  storageError: string
  startPayment: (amount: number, reservationData?: any, method?: "cash" | "card") => boolean
  addBill: (amount: number) => void
  recordCashReturned: (amount: number) => void
  completePayment: () => boolean
  cancelPayment: (refundedAmount?: number) => Promise<boolean>
  isPaymentComplete: () => boolean
  setCardInFlight: (busy: boolean) => boolean
  requireRecovery: (message: string, evidence?: PaymentSession["recoveryEvidence"]) => void
  savePendingBooking: (booking: PendingBooking) => boolean
}

const PaymentContext = createContext<PaymentContextType | undefined>(undefined)
const STORAGE_KEY = "kiosk-payment-recovery-v1"
const initialSession: PaymentSession = {
  isActive: false, acceptedAmount: 0, requiredAmount: 0, acceptedBills: [], sessionStartTime: 0, overpaymentAmount: 0,
}

export function PaymentProvider({ children }: { children: React.ReactNode }) {
  const [paymentSession, setPaymentSession] = useState<PaymentSession>(initialSession)
  const current = useRef(paymentSession)
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState("")

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const value = JSON.parse(saved) as PaymentSession
        if (typeof value.isActive !== "boolean" || !Number.isFinite(value.acceptedAmount) || value.acceptedAmount < 0 ||
            !Number.isFinite(value.requiredAmount) || value.requiredAmount < 0 || !Array.isArray(value.acceptedBills) ||
            value.acceptedBills.some(amount => !Number.isFinite(amount) || amount <= 0) ||
            (!value.isActive && (value.acceptedAmount > 0 || value.cardInFlight || value.pendingBooking || value.recoveryRequired || value.recoveryEvidence)) ||
            (value.pendingBooking && (typeof value.pendingBooking.requestId !== "string" || typeof value.pendingBooking.body !== "string"))) {
          throw new Error("Invalid saved payment")
        }
        if (value.pendingBooking && JSON.parse(value.pendingBooking.body)?.requestId !== value.pendingBooking.requestId) throw new Error("Invalid pending request")
        if (value.isActive) {
          // A restart cannot establish whether a physical payment finished.
          value.recoveryRequired ||= "이전 결제 확인이 필요합니다. 관리자에게 문의해주세요."
          current.current = value
          setPaymentSession(value)
        }
      }
    } catch {
      setStorageError("이전 결제 기록을 확인하지 못했습니다. 새 결제를 진행하지 말고 관리자에게 문의해주세요.")
    } finally {
      setReady(true)
    }
  }, [])

  const save = useCallback((next: PaymentSession) => {
    // Persist before another money operation or clearing its evidence.
    try {
      if (next.isActive) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else window.localStorage.removeItem(STORAGE_KEY)
      current.current = next
      setPaymentSession(next)
      return true
    } catch {
      const preserved = next.isActive ? next : current.current
      current.current = { ...preserved, isActive: true, recoveryRequired: "결제 기록 저장 오류입니다. 관리자 확인이 필요합니다." }
      setPaymentSession(current.current)
      setStorageError("결제 기록을 안전하게 저장하지 못했습니다. 관리자에게 문의해주세요.")
      return false
    }
  }, [])

  const startPayment = useCallback((requiredAmount: number, reservationData?: any, method?: "cash" | "card") => {
    const previous = current.current
    if (!ready || storageError || !Number.isSafeInteger(requiredAmount) || requiredAmount <= 0 || previous.acceptedAmount > 0 || previous.cardInFlight ||
        previous.pendingBooking || previous.recoveryRequired) return false
    return save({ ...initialSession, isActive: true, requiredAmount, reservationData, method, sessionStartTime: Date.now() })
  }, [ready, storageError, save])

  const addBill = useCallback((amount: number) => {
    const previous = current.current
    if (!previous.isActive || !Number.isFinite(amount) || amount <= 0) return
    const acceptedAmount = previous.acceptedAmount + amount
    save({ ...previous, acceptedAmount, acceptedBills: [...previous.acceptedBills, amount],
      overpaymentAmount: Math.max(0, acceptedAmount - previous.requiredAmount) })
  }, [save])

  const completePayment = useCallback(() => save(initialSession), [save])
  const recordCashReturned = useCallback((amount: number) => {
    const previous = current.current
    if (!previous.isActive || !Number.isSafeInteger(amount) || amount <= 0 || amount > previous.acceptedAmount) return
    const acceptedAmount = Math.max(0, previous.acceptedAmount - amount)
    save({ ...previous, acceptedAmount, returnedAmount: (previous.returnedAmount || 0) + amount,
      overpaymentAmount: Math.max(0, acceptedAmount - previous.requiredAmount) })
  }, [save])
  const cancelPayment = useCallback(async (refundedAmount = 0) => {
    const previous = current.current
    if (previous.pendingBooking || previous.cardInFlight || previous.recoveryRequired || previous.acceptedAmount > refundedAmount) return false
    return save(initialSession)
  }, [save])
  const setCardInFlight = useCallback((cardInFlight: boolean) => save({ ...current.current, cardInFlight }), [save])
  const requireRecovery = useCallback((recoveryRequired: string, evidence?: PaymentSession["recoveryEvidence"]) => {
    save({ ...current.current, isActive: true, recoveryRequired,
      ...(evidence ? { recoveryEvidence: evidence } : {}) })
  }, [save])
  const savePendingBooking = useCallback((pendingBooking: PendingBooking) => {
    return save({ ...current.current, isActive: true, pendingBooking })
  }, [save])
  const isPaymentComplete = useCallback(() => paymentSession.isActive && paymentSession.acceptedAmount >= paymentSession.requiredAmount, [paymentSession])

  return <PaymentContext.Provider value={{ paymentSession, ready, storageError, startPayment, addBill, recordCashReturned,
    completePayment, cancelPayment, isPaymentComplete, setCardInFlight, requireRecovery, savePendingBooking }}>
    {children}
  </PaymentContext.Provider>
}

export function usePayment() {
  const context = useContext(PaymentContext)
  if (context === undefined) throw new Error("usePayment must be used within a PaymentProvider")
  return context
}

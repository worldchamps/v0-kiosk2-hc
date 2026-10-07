"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import AdminKeypad from "@/components/admin-keypad"

// Browser-only compatibility. Installed kiosks validate in the main process,
// including the PC's KIOSK_ADMIN_PASSWORD override and attempt limit.
const adminPassword = "KIM1334**"
interface AdminSession {
  password: string
  authenticating: boolean
  authenticate: () => Promise<boolean>
  lock: () => void
}
const AdminContext = createContext<AdminSession | null>(null)

export function AdminProvider({ children }: { children: ReactNode }) {
  // Keep the existing IPC password checks; share the verified credential only
  // in this renderer's memory. Never persist it in browser storage or logs.
  const [password, setPassword] = useState("")
  const credential = useRef("")
  const [authenticating, setAuthenticating] = useState(false)
  const pending = useRef<{ promise: Promise<boolean>; resolve: (value: boolean) => void } | null>(null)
  const finish = useCallback((value: string) => {
    credential.current = value
    setPassword(value)
    setAuthenticating(false)
    pending.current?.resolve(Boolean(value))
    pending.current = null
  }, [])
  const lock = useCallback(() => finish(""), [finish])
  const authenticate = useCallback(() => {
    if (credential.current) return Promise.resolve(true)
    if (pending.current) return pending.current.promise
    let resolve!: (value: boolean) => void
    const promise = new Promise<boolean>(done => { resolve = done })
    pending.current = { promise, resolve }
    setAuthenticating(true)
    return promise
  }, [])
  const verify = async (value: string) => {
    if (!window.electronAPI) return value === adminPassword
    const result = await window.electronAPI.paymentRecovery?.authorize(value)
    if (!result?.success) throw new Error(result?.error || "관리자 인증을 확인하지 못했습니다.")
    return true
  }
  return <AdminContext.Provider value={{ password, authenticating, authenticate, lock }}>
    {children}
    {authenticating && <AdminKeypad showDevices={false} verifyPassword={verify} onConfirm={finish} onClose={lock} />}
  </AdminContext.Provider>
}

export function useAdmin() {
  const session = useContext(AdminContext)
  if (!session) throw new Error("AdminProvider is required")
  return session
}

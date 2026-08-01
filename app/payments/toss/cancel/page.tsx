"use client"

import { useEffect } from "react"
import { XCircle } from "lucide-react"

export default function TossPaymentCancelPage() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.close(), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-center">
      <div>
        <XCircle className="mx-auto mb-6 h-20 w-20 text-slate-500" />
        <h1 className="text-3xl font-bold">카드 결제가 취소되었습니다</h1>
        <p className="mt-4 text-xl text-slate-600">창이 닫히면 키오스크에서 다시 결제할 수 있습니다.</p>
      </div>
    </main>
  )
}

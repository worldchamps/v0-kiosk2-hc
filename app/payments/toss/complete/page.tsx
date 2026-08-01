"use client"

import { useEffect } from "react"
import { CheckCircle2 } from "lucide-react"

export default function TossPaymentCompletePage() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.close(), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-center">
      <div>
        <CheckCircle2 className="mx-auto mb-6 h-20 w-20 text-green-600" />
        <h1 className="text-3xl font-bold">결제 인증이 완료되었습니다</h1>
        <p className="mt-4 text-xl text-slate-600">키오스크에서 최종 결제 상태를 확인하고 있습니다.</p>
      </div>
    </main>
  )
}

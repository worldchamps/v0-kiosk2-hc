"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

interface LoadingScreenProps {
  redirectTo?: string
  message?: string
  autoRedirectDelay?: number
}

export default function LoadingScreen({
  redirectTo = "/",
  message = "화면 전환 중...",
  autoRedirectDelay = 2000,
}: LoadingScreenProps) {
  const router = useRouter()
  const [dots, setDots] = useState(".")

  // Animate the dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "." : prev + "."))
    }, 500)

    return () => clearInterval(interval)
  }, [])

  // Auto redirect after delay
  useEffect(() => {
    const timer = setTimeout(() => {
      router.push(redirectTo)
    }, autoRedirectDelay)

    return () => clearTimeout(timer)
  }, [redirectTo, autoRedirectDelay, router])

  // 컴포넌트가 마운트될 때 kiosk-mode 클래스 추가
  useEffect(() => {
    document.body.classList.add("kiosk-mode")

    return () => {
      document.body.classList.remove("kiosk-mode")
    }
  }, [])

  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-[#fefef7] kiosk-mode">
      <div className="flex flex-col items-center space-y-6">
        <Loader2 className="h-16 w-16 text-[#42c0ff] animate-spin" />
        <p className="text-3xl font-bold text-gray-800">
          {message}
          <span className="inline-block w-12">{dots}</span>
        </p>
      </div>
    </div>
  )
}

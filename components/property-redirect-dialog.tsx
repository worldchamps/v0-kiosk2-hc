"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ArrowRight } from "lucide-react"
import type { KioskScope } from "@/lib/kiosk-scope"
import Image from "next/image"
import { useEffect, useState, useRef } from "react"

interface PropertyRedirectDialogProps {
  target: KioskScope
  guestName: string
  onClose: () => void
}

// Keyed by building for beach kiosks (one per building), by property otherwise.
const REDIRECT_INFO: Record<string, { image: string; buildingName: string; kiosk: string }> = {
  A: { image: "/building-a-zoom.png", buildingName: "더 비치스테이 A동", kiosk: "A동" },
  B: { image: "/building-b-zoom.png", buildingName: "더 비치스테이 B동", kiosk: "B동" },
  C: { image: "/building-c-zoom.png", buildingName: "더 비치스테이 C동", kiosk: "C동" },
  D: { image: "/building-d-zoom.png", buildingName: "더 비치스테이 D동", kiosk: "D동" },
  property2: { image: "", buildingName: "Kariv Hotel", kiosk: "Kariv Hotel" }, // 전용 사진 전까지 비치 건물 사진으로 오해하지 않게 생략
  property4: { image: "/building-camp-zoom.png", buildingName: "더 캠프스테이", kiosk: "캠프스테이" },
}

export default function PropertyRedirectDialog({ target, guestName, onClose }: PropertyRedirectDialogProps) {
  const redirectInfo = REDIRECT_INFO[target.building ?? target.property]

  const [countdown, setCountdown] = useState(30)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null)
  // The parent passes a new onClose on every render; keep one 30s timer anyway.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    console.log("[v0] PropertyRedirectDialog mounted, starting 30-second countdown")

    // Countdown display timer (updates every second)
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 1000)

    // Auto-close timer (closes after 30 seconds)
    redirectTimerRef.current = setTimeout(() => {
      console.log("[v0] PropertyRedirectDialog auto-closing after 30 seconds")
      onCloseRef.current()
    }, 30000)

    // Cleanup timers on unmount
    return () => {
      console.log("[v0] PropertyRedirectDialog unmounting, clearing timers")
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
        countdownTimerRef.current = null
      }
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = null
      }
    }
  }, [])

  const handleClose = () => {
    console.log("[v0] PropertyRedirectDialog manually closed by user")
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
    }
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4 p-8">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* 건물 이미지 */}
          {redirectInfo.image && (
            <div className="w-full max-w-2xl h-96 relative rounded-xl overflow-hidden border-4 border-blue-500">
              <Image src={redirectInfo.image} alt={redirectInfo.buildingName} fill className="object-contain" priority />
            </div>
          )}

          {/* 안내 메시지 */}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <h2 className="text-4xl font-bold text-gray-900">{guestName ? `${guestName}님` : "고객님"}</h2>
              <ArrowRight className="w-8 h-8 text-blue-600" />
              <h2 className="text-4xl font-bold text-blue-600">{redirectInfo.buildingName}</h2>
            </div>

            <p className="text-3xl font-bold text-gray-900">예약하신 숙소는 {redirectInfo.buildingName}입니다.</p>

            <p className="text-2xl text-gray-700 leading-relaxed">체크인은 {redirectInfo.kiosk} 키오스크에서 확인해주시기 바랍니다.</p>
          </div>

          <div className="w-full bg-gray-100 rounded-lg p-4">
            <p className="text-lg text-gray-600 font-medium">{countdown}초 후 자동으로 처음 화면으로 돌아갑니다.</p>
          </div>

          {/* 확인 버튼 */}
          <div className="w-full pt-6">
            <Button onClick={handleClose} className="w-full h-20 text-2xl bg-blue-600 hover:bg-blue-700 font-bold">
              확인
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

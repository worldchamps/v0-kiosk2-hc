"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"
import { getCurrentDateKST, formatDateKorean } from "@/lib/date-utils"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playAudio } from "@/lib/audio-utils"
import { useEffect, useState, useRef } from "react"

interface ReservationNotFoundProps {
  onRecheck: () => void
  onNavigate: (screen: string) => void
  kioskLocation: KioskLocation
  isPopupMode?: boolean
}

export default function ReservationNotFound({
  onRecheck,
  onNavigate,
  kioskLocation,
  isPopupMode = false,
}: ReservationNotFoundProps) {
  const today = getCurrentDateKST()
  const formattedDate = formatDateKorean(today)

  const locationTitle = getLocationTitle(kioskLocation)

  const [countdown, setCountdown] = useState(30)
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    playAudio("RESERVATION_NOT_FOUND")

    // Start countdown
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 0
        }
        return prev - 1
      })
    }, 1000)

    // Auto-close after 30 seconds
    redirectTimeoutRef.current = setTimeout(() => {
      handleBackClick()
    }, 30000)

    // Cleanup
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
      }
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current)
      }
    }
  }, [])

  const handleBackClick = () => {
    // Clear timers
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
    }
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current)
    }

    if (isPopupMode && typeof window !== "undefined" && window.electronAPI) {
      // Popup mode: Close the Electron window
      window.electronAPI.send("checkin-complete")
    } else {
      // Normal mode: Navigate to standby
      onNavigate("standby")
    }
  }

  const handleRecheck = () => {
    // Clear timers when rechecking
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
    }
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current)
    }
    onRecheck()
  }

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">{locationTitle}</h1>
          <div className="kiosk-highlight">예약 확인 불가</div>
        </div>

        <div className="w-full mt-6">
          <Card className="w-full">
            <CardContent className="p-6 flex flex-col items-start justify-start space-y-4">
              <AlertCircle className="h-16 w-16 text-red-500" />

              <p className="text-left text-lg font-medium text-red-500">
                오늘({formattedDate}) 예약이 확인되지 않았습니다.
              </p>

              <p className="text-left text-gray-600">다른 날짜에 예약하셨거나, 이름이 다르게 등록되었을 수 있습니다.</p>

              <p className="text-left text-sm text-gray-500">{countdown}초 후 자동으로 처음 화면으로 돌아갑니다</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full mt-auto">
          <Button size="lg" className="h-12 text-lg" onClick={handleRecheck}>
            다시 확인
          </Button>

          <Button variant="outline" size="lg" className="h-12 text-lg bg-transparent" onClick={handleBackClick}>
            돌아가기
          </Button>
        </div>
      </div>
    </div>
  )
}

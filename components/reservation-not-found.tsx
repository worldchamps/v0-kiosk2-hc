"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"
import { getCurrentDateKST, formatDateKorean } from "@/lib/date-utils"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playAudio } from "@/lib/audio-utils"
import { useEffect } from "react"
import { useIdleTimer } from "@/hooks/use-idle-timer"

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

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] Reservation not found idle, navigating to idle screen")
      onNavigate("idle")
    },
    idleTime: 60000, // 60 seconds
    enabled: true,
  })

  useEffect(() => {
    playAudio("RESERVATION_NOT_FOUND")
  }, [])

  const handleBackClick = () => {
    if (isPopupMode && typeof window !== "undefined" && window.electronAPI) {
      // Popup mode: Close the Electron window
      window.electronAPI.send("checkin-complete")
    } else {
      // Normal mode: Navigate to standby
      onNavigate("standby")
    }
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
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full mt-auto">
          <Button size="lg" className="h-12 text-lg" onClick={onRecheck}>
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

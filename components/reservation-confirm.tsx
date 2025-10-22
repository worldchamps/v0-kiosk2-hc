"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import KoreanKeyboard from "./korean-keyboard"
import { Loader2 } from "lucide-react"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"

interface ReservationConfirmProps {
  onNavigate: (screen: string) => void
  onCheckReservation: (name: string) => void
  guestName: string
  setGuestName: (name: string) => void
  loading?: boolean
  kioskLocation: KioskLocation
  isPopupMode?: boolean
}

export default function ReservationConfirm({
  onNavigate,
  onCheckReservation,
  guestName,
  setGuestName,
  loading = false,
  kioskLocation,
  isPopupMode = false,
}: ReservationConfirmProps) {
  const [showKeyboard, setShowKeyboard] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const locationTitle = getLocationTitle(kioskLocation)

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] Reservation confirm idle, navigating to idle screen")
      onNavigate("idle")
    },
    idleTime: 60000,
    enabled: true,
  })

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }

    playAudio("RESERVATION_PROMPT")
  }, [])

  const handleCheckReservation = () => {
    if (guestName.trim() && !loading) {
      onCheckReservation(guestName)
    }
  }

  const handleBackClick = () => {
    if (isPopupMode) {
      if (typeof window !== "undefined" && window.electronAPI) {
        window.electronAPI.send("checkin-complete")
      }
    } else {
      onNavigate("standby")
      setGuestName("")
    }
  }

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">{locationTitle}</h1>
          <div className="kiosk-highlight">예약 확인</div>
        </div>

        <div className="w-full space-y-8 mt-8">
          <div className="space-y-4">
            <label htmlFor="guestName" className="text-5xl font-bold">
              예약자명을 입력해주세요
            </label>
            <Input
              id="guestName"
              ref={inputRef}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="예약자명"
              className="h-24 p-5 border-3 text-center border-gray-300 rounded-lg font-normal bg-white"
              style={{ padding: "40px", fontSize: "40px" }}
              disabled={loading}
            />
          </div>

          <div className="mt-8">
            <KoreanKeyboard
              text={guestName}
              setText={setGuestName}
              onEnter={handleCheckReservation}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-8 pt-8">
            <Button
              onClick={handleCheckReservation}
              disabled={!guestName.trim() || loading}
              className="h-20 text-2xl text-black bg-[#42c0ff] hover:bg-[#3ab0e8] shadow-md font-bold rounded-xl"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-3 h-8 w-8 animate-spin" />
                  처리 중...
                </>
              ) : (
                "입력완료"
              )}
            </Button>

            <Button
              variant="outline"
              onClick={handleBackClick}
              className="h-20 text-2xl border-3 border-gray-300 font-bold rounded-xl bg-transparent"
              disabled={loading}
            >
              돌아가기
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

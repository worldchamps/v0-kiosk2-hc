"use client"

import { useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import KoreanKeyboard from "./korean-keyboard"
import { ArrowLeft, Loader2, QrCode, Search } from "lucide-react"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { getKioskPropertyId, propertyUsesElectron } from "@/lib/property-utils"

interface ReservationConfirmProps {
  onNavigate: (screen: string) => void
  onCheckReservation: (name: string) => void
  onScanReservationQr: () => void
  guestName: string
  setGuestName: (name: string) => void
  loading?: boolean
  kioskLocation: KioskLocation
  isPopupMode?: boolean
}

export default function ReservationConfirm({
  onNavigate,
  onCheckReservation,
  onScanReservationQr,
  guestName,
  setGuestName,
  loading = false,
  kioskLocation,
  isPopupMode = false,
}: ReservationConfirmProps) {
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
      const property = getKioskPropertyId()
      if (propertyUsesElectron(property)) {
        if (typeof window !== "undefined" && window.electronAPI) {
          window.electronAPI.send("checkin-complete")
        }
      } else {
        window.close()
      }
    } else {
      onNavigate("standby")
      setGuestName("")
    }
  }

  return (
    <main className="kiosk-reservation-lookup">
      <header className="kiosk-reservation-header">
        <button
          type="button"
          className="kiosk-reservation-back"
          onClick={handleBackClick}
          disabled={loading}
        >
          <ArrowLeft aria-hidden="true" />
          <span>돌아가기</span>
        </button>

        <div className="kiosk-reservation-brand">
          <span>{locationTitle}</span>
          <strong>예약 확인</strong>
        </div>

        <div aria-hidden="true" />
      </header>

      <section className="kiosk-reservation-intro" aria-labelledby="reservation-lookup-title">
        <p>예약 고객 전용</p>
        <h1 id="reservation-lookup-title">예약을 어떻게<br />찾을까요?</h1>
        <span>QR을 스캔하거나 예약자명을 입력해주세요.</span>
      </section>

      <section className="kiosk-reservation-panel">
        <button
            type="button"
            onClick={onScanReservationQr}
            disabled={loading}
            className="kiosk-reservation-qr"
          >
            <span className="kiosk-reservation-qr-icon">
              {loading ? <Loader2 className="animate-spin" /> : <QrCode />}
            </span>
            <span className="kiosk-reservation-qr-copy">
              <strong>예약 QR 스캔</strong>
              <small>문자 또는 예약 사이트의 QR을 보여주세요</small>
            </span>
            <Search aria-hidden="true" />
        </button>

        <div className="kiosk-reservation-divider">
          <span>또는 예약자명으로 찾기</span>
        </div>

        <div className="kiosk-reservation-name">
          <label htmlFor="guestName">예약자명</label>
          <Input
            id="guestName"
            ref={inputRef}
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="성함을 입력해주세요"
            className="kiosk-reservation-input"
            disabled={loading}
          />
          <p>예약할 때 입력한 이름과 동일하게 입력해주세요.</p>
        </div>

        <div className="kiosk-reservation-keyboard">
          <KoreanKeyboard
            text={guestName}
            setText={setGuestName}
            onEnter={handleCheckReservation}
            disabled={loading}
            hideEnter
          />
        </div>

        <button
          type="button"
          onClick={handleCheckReservation}
          disabled={!guestName.trim() || loading}
          className="kiosk-reservation-submit"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              예약을 찾고 있어요
            </>
          ) : (
            <>
              예약 확인하기
              <Search aria-hidden="true" />
            </>
          )}
        </button>
      </section>

    </main>
  )
}

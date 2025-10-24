"use client"

import Image from "next/image"
import { useEffect, useRef } from "react"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playIdleWelcome, pauseBGM } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"

interface StandbyScreenProps {
  onNavigate: (screen: string) => void
  kioskLocation: KioskLocation
}

export default function StandbyScreen({ onNavigate, kioskLocation }: StandbyScreenProps) {
  // 위치에 따른 제목
  const locationTitle = getLocationTitle(kioskLocation)
  const welcomeAudioPlayedRef = useRef(false)

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] Standby screen idle, navigating to idle screen")
      onNavigate("idle")
    },
    idleTime: 60000, // 60 seconds
    enabled: true,
  })

  useEffect(() => {
    console.log("StandbyScreen mounted - playing welcome audio and BGM")

    if (!welcomeAudioPlayedRef.current) {
      playIdleWelcome()
      welcomeAudioPlayedRef.current = true
    }

    // 컴포넌트 언마운트 시 BGM 일시 중지
    return () => {
      console.log("StandbyScreen unmounted - pausing BGM")
      pauseBGM()
    }
  }, [])

  return (
    <div className="flex items-start justify-start w-full h-full bg-[#fefef7] overflow-hidden">
      <div className="kiosk-content-container">
        {/* Header */}
        <div>
          <h1 className="kiosk-title">{locationTitle}</h1>
          <div className="kiosk-highlight">셀프 체크인</div>
        </div>

        {/* Main Button Stack */}
        <div className="kiosk-buttons-container">
          {/* Reservation Check Button */}
          <button className="kiosk-card" onClick={() => onNavigate("reservationConfirm")}>
            <div>
              <h2>예약확인</h2>
              <p>
                야놀자 여기어때 네이버
                <br />
                객실 호수랑 비밀번호 확인하세요
              </p>
            </div>
            <Image src="/calendar-icon.png" alt="Calendar" width={80} height={80} className="kiosk-icon" />
          </button>

          {/* Current Location Button */}
          <button className="kiosk-card" onClick={() => onNavigate("currentLocation")}>
            <div>
              <h2>위치 안내도</h2>
              <p>
                전체 업장 지도
                <br />
                관리실, 부대시설, 주차장
              </p>
            </div>
            <Image src="/location-pin-icon.png" alt="Location" width={80} height={80} className="kiosk-icon" />
          </button>

          <button className="kiosk-card" onClick={() => onNavigate("onSiteReservation")}>
            <div>
              <h2>현장예약</h2>
              <p>
                예약 가능한 객실 확인
                <br />
                즉시 예약 가능합니다
              </p>
            </div>
            <Image src="/desk-icon.png" alt="Desk" width={80} height={80} className="kiosk-icon" />
          </button>
        </div>
      </div>
    </div>
  )
}

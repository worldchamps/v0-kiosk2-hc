"use client"

import { useState, useEffect } from "react"
import StandbyScreen from "@/components/standby-screen"
import ReservationConfirm from "@/components/reservation-confirm"
import CurrentLocation from "@/components/current-location"
import OnSiteReservation from "@/components/on-site-reservation"
import ReservationDetails from "@/components/reservation-details"
import CheckInComplete from "@/components/check-in-complete"
import ReservationNotFound from "@/components/reservation-not-found"
import { getCurrentDateKST } from "@/lib/date-utils"
import { type KioskLocation, getKioskLocation } from "@/lib/location-utils"
import { useRouter } from "next/navigation"
import AdminKeypad from "@/components/admin-keypad"
// 음성 유틸리티 import 수정
import { stopAllAudio, pauseBGM, resumeBGM } from "@/lib/audio-utils"

interface KioskLayoutProps {
  onChangeMode: () => void
}

export default function KioskLayout({ onChangeMode }: KioskLayoutProps) {
  const [currentScreen, setCurrentScreen] = useState("standby")
  const [reservationData, setReservationData] = useState(null)
  const [guestName, setGuestName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [revealedInfo, setRevealedInfo] = useState({
    roomNumber: "",
    password: "",
    floor: "",
  })
  const [debugInfo, setDebugInfo] = useState(null)
  const [showAdminKeypad, setShowAdminKeypad] = useState(false)
  const [kioskLocation, setKioskLocation] = useState<KioskLocation>("A")
  const router = useRouter()

  // 관리자 비밀번호 - 변경됨
  const adminPassword = "KIM1334**"

  // 키오스크 위치 불러오기
  useEffect(() => {
    const savedLocation = getKioskLocation()
    setKioskLocation(savedLocation)
  }, [])

  // 디버깅 정보 표시
  useEffect(() => {
    if (debugInfo) {
      console.log("Debug Info:", debugInfo)
    }
  }, [debugInfo])

  // 컴포넌트가 마운트될 때 body에 kiosk-mode 클래스 추가
  useEffect(() => {
    // body에 kiosk-mode 클래스 추가
    document.body.classList.add("kiosk-mode")

    // 컴포넌트가 언마운트될 때 kiosk-mode 클래스 제거
    return () => {
      document.body.classList.remove("kiosk-mode")
      // 모든 오디오 중지 (BGM 포함)
      stopAllAudio(true)
    }
  }, [])

  // 화면 전환 시 BGM 관리
  useEffect(() => {
    // 대기 화면일 때 BGM 재개, 다른 화면일 때는 BGM 일시 중지
    if (currentScreen === "standby") {
      console.log("Resuming BGM (screen changed to standby)")
      resumeBGM()
    } else {
      console.log("Pausing BGM (screen changed from standby)")
      pauseBGM()
    }
  }, [currentScreen])

  // handleNavigate 함수 수정
  const handleNavigate = (screen) => {
    // 화면 전환 시 모든 오디오 중지 (BGM 제외)
    stopAllAudio(false)

    setCurrentScreen(screen)
    // Clear any previous errors when navigating
    setError("")

    // Clear the guest name when navigating away from reservation confirmation
    if (screen !== "reservationConfirm" && screen !== "reservationDetails") {
      setGuestName("")
    }

    // Reset reservation data and revealed info when going back to standby
    if (screen === "standby") {
      setReservationData(null)
      setRevealedInfo({
        roomNumber: "",
        password: "",
        floor: "",
      })
    }
  }

  const handleModeChangeClick = () => {
    console.log("관리자 버튼 클릭됨!")
    setShowAdminKeypad(true)
    console.log("showAdminKeypad 상태:", true)
  }

  const handlePasswordConfirm = (password: string) => {
    console.log("비밀번호 확인됨:", password)
    setShowAdminKeypad(false)
    onChangeMode()
  }

  const handleAdminKeypadClose = () => {
    console.log("관리자 키패드 닫기")
    setShowAdminKeypad(false)
  }

  // 예약 확인 함수 수정 - 이름 또는 예약 ID로 검색
  const handleCheckReservation = async (searchTerm) => {
    if (!searchTerm.trim()) return

    setLoading(true)
    setError("")
    setDebugInfo(null)

    try {
      console.log(`Checking reservation for: ${searchTerm}, today: ${getCurrentDateKST()}`)

      // 검색어가 숫자/영문자 조합이고 6자리인지 확인 (예약 ID 뒷자리)
      const isReservationId = /^[A-Za-z0-9]{6}$/.test(searchTerm.trim())

      let apiUrl = ""
      if (isReservationId) {
        // 예약 ID 뒷자리로 검색
        apiUrl = `/api/reservations?reservationIdSuffix=${encodeURIComponent(searchTerm)}&todayOnly=true`
      } else {
        // 이름으로 검색
        apiUrl = `/api/reservations?name=${encodeURIComponent(searchTerm)}&todayOnly=true`
      }

      const response = await fetch(apiUrl, {
        method: "GET",
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      setDebugInfo(data.debug || null)

      console.log("API Response:", data)

      if (data.reservations && data.reservations.length > 0) {
        // 여러 예약이 있는 경우 처리
        if (data.reservations.length > 1) {
          console.log(`Multiple reservations found for ${searchTerm}:`, data.reservations)
          // 첫 번째 예약을 선택하거나, 별도 선택 화면으로 이동할 수 있음
          // 현재는 첫 번째 예약을 선택
        }

        const reservation = data.reservations[0]
        console.log("Found reservation:", reservation)

        setReservationData(reservation)
        setCurrentScreen("reservationDetails")
      } else {
        // 오늘 날짜에 예약이 없는 경우
        const today = getCurrentDateKST()
        console.log(`No reservation found for ${searchTerm} on ${today}`)
        setCurrentScreen("reservationNotFound")
      }
    } catch (err) {
      console.error("Error checking reservation:", err)
      setError("예약 확인 중 오류가 발생했습니다. 다시 시도해 주세요.")
      setCurrentScreen("reservationNotFound")
    } finally {
      setLoading(false)
    }
  }

  // Update the handleCheckIn function to remove API key
  const handleCheckIn = async () => {
    if (!reservationData || !reservationData.reservationId) return

    setLoading(true)
    setError("")

    try {
      console.log(`Checking in reservation: ${reservationData.reservationId}`)

      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: reservationData.reservationId,
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      console.log("Check-in response:", data)

      // Save room number and password
      if (data.data) {
        setRevealedInfo({
          roomNumber: data.data.roomNumber || "",
          password: data.data.password || "",
          floor: data.data.floor || "", // Add floor information
        })

        console.log("Revealed info:", {
          roomNumber: data.data.roomNumber,
          password: data.data.password,
          floor: data.data.floor,
        })
      }

      // Switch to check-in complete screen
      setCurrentScreen("checkInComplete")
    } catch (err) {
      console.error("Error during check-in:", err)
      setError("체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")
    } finally {
      setLoading(false)
    }
  }

  // 디버깅을 위한 상태 로그
  useEffect(() => {
    console.log("showAdminKeypad 상태 변경:", showAdminKeypad)
  }, [showAdminKeypad])

  return (
    <div className="w-full h-full bg-[#fefef7] overflow-hidden kiosk-mode relative">
      <div className="h-full w-full">
        {error && <div className="m-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

        {currentScreen === "standby" && <StandbyScreen onNavigate={handleNavigate} kioskLocation={kioskLocation} />}

        {currentScreen === "reservationConfirm" && (
          <ReservationConfirm
            onNavigate={handleNavigate}
            onCheckReservation={handleCheckReservation}
            guestName={guestName}
            setGuestName={setGuestName}
            loading={loading}
            kioskLocation={kioskLocation}
          />
        )}

        {currentScreen === "currentLocation" && (
          <CurrentLocation onNavigate={handleNavigate} kioskLocation={kioskLocation} />
        )}

        {currentScreen === "onSiteReservation" && (
          <OnSiteReservation onNavigate={handleNavigate} kioskLocation={kioskLocation} />
        )}

        {currentScreen === "reservationDetails" && (
          <ReservationDetails
            reservation={reservationData}
            onCheckIn={handleCheckIn}
            onNavigate={handleNavigate}
            loading={loading}
            revealedInfo={revealedInfo}
            kioskLocation={kioskLocation}
          />
        )}

        {currentScreen === "checkInComplete" && (
          <CheckInComplete
            reservation={reservationData}
            revealedInfo={revealedInfo}
            kioskLocation={kioskLocation}
            onNavigate={handleNavigate} // Add this line
          />
        )}

        {currentScreen === "reservationNotFound" && (
          <ReservationNotFound
            onRecheck={() => setCurrentScreen("reservationConfirm")}
            onNavigate={handleNavigate}
            kioskLocation={kioskLocation}
          />
        )}
      </div>

      {/* 관리자 모드 접근 버튼 - 더 명확하게 표시 */}
      <div className="absolute bottom-4 right-4">
        <button
          className="px-4 py-2 bg-gray-800 text-white rounded-lg opacity-70 hover:opacity-100 transition-opacity text-sm font-medium shadow-lg"
          onClick={handleModeChangeClick}
          aria-label="관리자 모드"
        >
          관리자
        </button>
      </div>

      {/* 관리자 키패드 - z-index 추가 */}
      {showAdminKeypad && (
        <div className="fixed inset-0 z-50">
          <AdminKeypad
            onClose={handleAdminKeypadClose}
            onConfirm={handlePasswordConfirm}
            adminPassword={adminPassword}
          />
        </div>
      )}

      {/* 디버깅용 상태 표시 (개발 중에만 사용) */}
      {process.env.NODE_ENV === "development" && (
        <div className="fixed top-4 left-4 bg-black text-white p-2 rounded text-xs z-40">
          Admin Keypad: {showAdminKeypad ? "OPEN" : "CLOSED"}
        </div>
      )}
    </div>
  )
}

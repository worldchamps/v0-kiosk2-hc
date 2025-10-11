"use client"

import { useState, useEffect } from "react"
import StandbyScreen from "@/components/standby-screen"
import IdleScreen from "@/components/idle-screen"
import ReservationConfirm from "@/components/reservation-confirm"
import CurrentLocation from "@/components/current-location"
import OnSiteReservation from "@/components/on-site-reservation"
import ReservationDetails from "@/components/reservation-details"
import CheckInComplete from "@/components/check-in-complete"
import ReservationNotFound from "@/components/reservation-not-found"
import ReservationList from "@/components/reservation-list"
import { getCurrentDateKST } from "@/lib/date-utils"
import { type KioskLocation, getKioskLocation } from "@/lib/location-utils"
import { useRouter } from "next/navigation"
import AdminKeypad from "@/components/admin-keypad"
import { stopAllAudio, pauseBGM, resumeBGM } from "@/lib/audio-utils"

interface KioskLayoutProps {
  onChangeMode: () => void
}

export default function KioskLayout({ onChangeMode }: KioskLayoutProps) {
  const [currentScreen, setCurrentScreen] = useState("standby")
  const [reservationData, setReservationData] = useState(null)
  const [reservationsList, setReservationsList] = useState([])
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

  const adminPassword = "KIM1334**"

  useEffect(() => {
    const savedLocation = getKioskLocation()
    setKioskLocation(savedLocation)
  }, [])

  useEffect(() => {
    if (debugInfo) {
      console.log("Debug Info:", debugInfo)
    }
  }, [debugInfo])

  useEffect(() => {
    document.body.classList.add("kiosk-mode")
    return () => {
      document.body.classList.remove("kiosk-mode")
      stopAllAudio(true)
    }
  }, [])

  useEffect(() => {
    if (currentScreen === "standby") {
      console.log("Resuming BGM (screen changed to standby)")
      resumeBGM()
    } else {
      console.log("Pausing BGM (screen changed from standby)")
      pauseBGM()
    }
  }, [currentScreen])

  const handleNavigate = (screen) => {
    stopAllAudio(false)

    setCurrentScreen(screen)
    setError("")

    if (screen !== "reservationConfirm" && screen !== "reservationDetails" && screen !== "reservationList") {
      setGuestName("")
    }

    if (screen === "standby" || screen === "idle") {
      setReservationData(null)
      setReservationsList([])
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

  const handleCheckReservation = async (name) => {
    if (!name.trim()) return

    setLoading(true)
    setError("")
    setDebugInfo(null)

    try {
      console.log(`Checking reservation for: ${name}, today: ${getCurrentDateKST()}`)

      const response = await fetch(`/api/reservations?name=${encodeURIComponent(name)}&todayOnly=false`, {
        method: "GET",
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      setDebugInfo(data.debug || null)

      console.log("API Response:", data)

      if (data.reservations && data.reservations.length > 0) {
        if (data.reservations.length > 1) {
          console.log(`Found ${data.reservations.length} reservations for ${name}`)
          setReservationsList(data.reservations)
          setCurrentScreen("reservationList")
        } else {
          const reservation = data.reservations[0]
          console.log("Found reservation:", reservation)
          setReservationData(reservation)
          setCurrentScreen("reservationDetails")
        }
      } else {
        const today = getCurrentDateKST()
        console.log(`No reservation found for ${name} on ${today}`)
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

      if (data.data) {
        setRevealedInfo({
          roomNumber: data.data.roomNumber || "",
          password: data.data.password || "",
          floor: data.data.floor || "",
        })

        console.log("Revealed info:", {
          roomNumber: data.data.roomNumber,
          password: data.data.password,
          floor: data.data.floor,
        })
      }

      setCurrentScreen("checkInComplete")
    } catch (err) {
      console.error("Error during check-in:", err)
      setError("체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")
    } finally {
      setLoading(false)
    }
  }

  const handleSelectReservation = (reservation) => {
    console.log("Selected reservation:", reservation)
    setReservationData(reservation)
    setCurrentScreen("reservationDetails")
  }

  useEffect(() => {
    console.log("showAdminKeypad 상태 변경:", showAdminKeypad)
  }, [showAdminKeypad])

  return (
    <div className="w-full h-full bg-[#fefef7] overflow-hidden kiosk-mode relative">
      <div className="h-full w-full">
        {error && <div className="m-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

        {currentScreen === "idle" && (
          <IdleScreen onNavigate={handleNavigate} kioskLocation={kioskLocation} videoUrl="/idle-video.mp4" />
        )}

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

        {currentScreen === "reservationList" && (
          <ReservationList
            reservations={reservationsList}
            onSelectReservation={handleSelectReservation}
            onNavigate={handleNavigate}
            kioskLocation={kioskLocation}
            guestName={guestName}
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
            onNavigate={handleNavigate}
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

      <div className="absolute bottom-4 right-4">
        <button
          className="px-4 py-2 bg-gray-800 text-white rounded-lg opacity-70 hover:opacity-100 transition-opacity text-sm font-medium shadow-lg"
          onClick={handleModeChangeClick}
          aria-label="관리자 모드"
        >
          관리자
        </button>
      </div>

      {showAdminKeypad && (
        <div className="fixed inset-0 z-50">
          <AdminKeypad
            onClose={handleAdminKeypadClose}
            onConfirm={handlePasswordConfirm}
            adminPassword={adminPassword}
          />
        </div>
      )}

      {process.env.NODE_ENV === "development" && (
        <div className="fixed top-4 left-4 bg-black text-white p-2 rounded text-xs z-40">
          Admin Keypad: {showAdminKeypad ? "OPEN" : "CLOSED"}
        </div>
      )}
    </div>
  )
}

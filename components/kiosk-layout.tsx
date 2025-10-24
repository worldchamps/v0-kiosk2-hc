"use client"

import { useState, useEffect, useRef } from "react"
import StandbyScreen from "@/components/standby-screen"
import IdleScreen from "@/components/idle-screen"
import ReservationConfirm from "@/components/reservation-confirm"
import CurrentLocation from "@/components/current-location"
import OnSiteReservation from "@/components/on-site-reservation"
import ReservationDetails from "@/components/reservation-details"
import CheckInComplete from "@/components/check-in-complete"
import ReservationNotFound from "@/components/reservation-not-found"
import ReservationList from "@/components/reservation-list"
import { type KioskLocation, getKioskLocation } from "@/lib/location-utils"
import { useRouter } from "next/navigation"
import AdminKeypad from "@/components/admin-keypad"
import { stopAllAudio, pauseBGM, resumeBGM } from "@/lib/audio-utils"
import { PrintQueueListener } from "@/components/print-queue-listener"
import {
  getKioskPropertyId,
  type PropertyId,
  getPropertyDisplayName,
  getPropertyFromRoomNumber,
  getPropertyFromPlace,
} from "@/lib/property-utils"
import PropertyMismatchDialog from "@/components/property-mismatch-dialog"
import PropertyRedirectDialog from "@/components/property-redirect-dialog"

interface KioskLayoutProps {
  onChangeMode: () => void
}

export default function KioskLayout({ onChangeMode }: KioskLayoutProps) {
  const [currentScreen, setCurrentScreen] = useState("idle")
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
  const [showAdminKeypad, setShowAdminKeypad] = useState(false)
  const [kioskLocation, setKioskLocation] = useState<KioskLocation>("A")
  const [isPopupMode, setIsPopupMode] = useState(false)
  const [kioskProperty, setKioskProperty] = useState<PropertyId>("property3")
  const [showPropertyMismatch, setShowPropertyMismatch] = useState(false)
  const [mismatchData, setMismatchData] = useState<{
    reservationProperty: PropertyId
    kioskProperty: PropertyId
    debugInfo?: {
      roomNumber: string
      place: string
      detectedFromRoom: PropertyId | null
      detectedFromPlace: PropertyId | null
    }
  } | null>(null)
  const [adminOverride, setAdminOverride] = useState(false)
  const [showPropertyRedirect, setShowPropertyRedirect] = useState(false)
  const [redirectTargetProperty, setRedirectTargetProperty] = useState<PropertyId | null>(null)
  const router = useRouter()
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null)
  const INACTIVITY_TIMEOUT = 30000 // 30 seconds

  const adminPassword = "KIM1334**"

  useEffect(() => {
    const savedLocation = getKioskLocation()
    setKioskLocation(savedLocation)

    const savedProperty = getKioskPropertyId()
    setKioskProperty(savedProperty)

    console.log("[v0] ========================================")
    console.log("[v0] 🏢 Kiosk Initialization")
    console.log("[v0] ========================================")
    console.log("[v0] Property ID:", savedProperty)
    console.log("[v0] Property Name:", getPropertyDisplayName(savedProperty))
    console.log("[v0] Location:", savedLocation)
    console.log("[v0] Environment:", typeof window === "undefined" ? "Server" : "Client")
    console.log("[v0] Is Electron:", typeof window !== "undefined" && !!(window as any).electronAPI)
    console.log("[v0] ========================================")
  }, [])

  useEffect(() => {
    document.body.classList.add("kiosk-mode")
    return () => {
      document.body.classList.remove("kiosk-mode")
      stopAllAudio(true)
    }
  }, [])

  useEffect(() => {
    if (currentScreen === "standby") {
      resumeBGM()
    } else {
      pauseBGM()
    }
  }, [currentScreen])

  useEffect(() => {
    if (!isPopupMode) return

    console.log("[v0] Overlay mode detected - starting 30s auto-close timer")

    const resetTimer = () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
      }

      inactivityTimerRef.current = setTimeout(() => {
        console.log("[v0] 30s inactivity timeout - closing popup")
        if (typeof window !== "undefined" && (window as any).electronAPI) {
          ;(window as any).electronAPI.send("close-popup")
        }
      }, INACTIVITY_TIMEOUT)
    }

    // Start initial timer
    resetTimer()

    // Reset timer on any user interaction
    const handleUserActivity = () => {
      console.log("[v0] User activity detected - resetting timer")
      resetTimer()
    }

    // Listen to various user interaction events
    window.addEventListener("click", handleUserActivity)
    window.addEventListener("touchstart", handleUserActivity)
    window.addEventListener("keydown", handleUserActivity)
    window.addEventListener("mousemove", handleUserActivity)

    // Cleanup
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
      }
      window.removeEventListener("click", handleUserActivity)
      window.removeEventListener("touchstart", handleUserActivity)
      window.removeEventListener("keydown", handleUserActivity)
      window.removeEventListener("mousemove", handleUserActivity)
    }
  }, [isPopupMode])

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
    setShowAdminKeypad(true)
  }

  const handlePasswordConfirm = (password: string) => {
    setShowAdminKeypad(false)
    onChangeMode()
  }

  const handleAdminKeypadClose = () => {
    setShowAdminKeypad(false)
  }

  const handleCheckReservation = async (name) => {
    if (!name.trim()) return

    setLoading(true)
    setError("")

    try {
      const response = await fetch(
        `/api/reservations?name=${encodeURIComponent(name)}&todayOnly=false&kioskProperty=${kioskProperty}`,
        {
          method: "GET",
        },
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.reservations && data.reservations.length > 0) {
        if (data.reservations.length > 1) {
          setReservationsList(data.reservations)
          setCurrentScreen("reservationList")
        } else {
          const reservation = data.reservations[0]
          setReservationData(reservation)
          setCurrentScreen("reservationDetails")
        }
      } else {
        console.log("[v0] No reservation found in current property, searching all properties...")
        const allPropertiesResponse = await fetch(
          `/api/reservations?name=${encodeURIComponent(name)}&todayOnly=false&searchAll=true`,
          {
            method: "GET",
          },
        )

        if (!allPropertiesResponse.ok) {
          throw new Error(`API error: ${allPropertiesResponse.status}`)
        }

        const allPropertiesData = await allPropertiesResponse.json()

        if (allPropertiesData.reservations && allPropertiesData.reservations.length > 0) {
          const foundReservation = allPropertiesData.reservations[0]
          const targetProperty = foundReservation.property

          console.log("[v0] Reservation found in different property:", targetProperty)

          setRedirectTargetProperty(targetProperty)
          setShowPropertyRedirect(true)
        } else {
          setCurrentScreen("reservationNotFound")
        }
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
      console.log("[v0] Starting check-in process for:", reservationData.reservationId)

      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: reservationData.reservationId,
          kioskProperty: kioskProperty,
          adminOverride: adminOverride,
        }),
      })

      if (response.status === 403) {
        const errorData = await response.json()

        const detectedFromRoom = getPropertyFromRoomNumber(reservationData.roomNumber)
        const detectedFromPlace = getPropertyFromPlace(reservationData.place)

        setMismatchData({
          reservationProperty: errorData.reservationProperty,
          kioskProperty: errorData.kioskProperty,
          debugInfo: {
            roomNumber: reservationData.roomNumber,
            place: reservationData.place,
            detectedFromRoom,
            detectedFromPlace,
          },
        })
        setShowPropertyMismatch(true)
        setLoading(false)
        return
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      console.log("[v0] Check-in API response:", data)

      if (data.data) {
        setRevealedInfo({
          roomNumber: data.data.roomNumber || "",
          password: data.data.password || "",
          floor: data.data.floor || "",
        })
      }

      setAdminOverride(false)

      if (!isPopupMode) {
        console.log("[v0] Normal mode: Navigating to check-in complete")
        setCurrentScreen("checkInComplete")
      } else {
        console.log("[v0] Popup mode: Check-in complete, window will close")
      }
    } catch (err) {
      console.error("[v0] Error during check-in:", err)
      setError("체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")

      if (isPopupMode) {
        alert("체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSelectReservation = (reservation) => {
    setReservationData(reservation)
    setCurrentScreen("reservationDetails")
  }

  const handleAdminOverride = () => {
    setShowPropertyMismatch(false)
    setAdminOverride(true)
    handleCheckIn()
  }

  return (
    <div className="w-full h-full bg-[#fefef7] overflow-hidden kiosk-mode relative">
      <div className="h-full w-full">
        {error && <div className="m-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

        {currentScreen === "idle" && (
          <IdleScreen onNavigate={handleNavigate} kioskLocation={kioskLocation} imageUrl="/idle-image.jpg" />
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
            isPopupMode={isPopupMode}
          />
        )}

        {currentScreen === "reservationList" && (
          <ReservationList
            reservations={reservationsList}
            onSelectReservation={handleSelectReservation}
            onNavigate={handleNavigate}
            kioskLocation={kioskLocation}
            guestName={guestName}
            isPopupMode={isPopupMode}
          />
        )}

        {currentScreen === "currentLocation" && (
          <CurrentLocation onNavigate={handleNavigate} kioskLocation={kioskLocation} />
        )}

        {currentScreen === "onSiteReservation" && (
          <OnSiteReservation onNavigate={handleNavigate} location={kioskLocation} />
        )}

        {currentScreen === "reservationDetails" && (
          <ReservationDetails
            reservation={reservationData}
            onCheckIn={handleCheckIn}
            onNavigate={handleNavigate}
            loading={loading}
            revealedInfo={revealedInfo}
            isPopupMode={isPopupMode}
            kioskLocation={kioskLocation}
          />
        )}

        {currentScreen === "checkInComplete" && (
          <CheckInComplete
            reservation={reservationData}
            revealedInfo={revealedInfo}
            kioskLocation={kioskLocation}
            onNavigate={handleNavigate}
            isPopupMode={isPopupMode}
          />
        )}

        {currentScreen === "reservationNotFound" && (
          <ReservationNotFound
            onRecheck={() => setCurrentScreen("reservationConfirm")}
            onNavigate={handleNavigate}
            kioskLocation={kioskLocation}
            isPopupMode={isPopupMode}
          />
        )}
      </div>

      {!isPopupMode && (
        <div className="absolute bottom-4 right-4">
          <button
            className="px-4 py-2 bg-gray-800 text-white rounded-lg opacity-70 hover:opacity-100 transition-opacity text-sm font-medium shadow-lg"
            onClick={handleModeChangeClick}
            aria-label="관리자 모드"
          >
            관리자
          </button>
        </div>
      )}

      {showAdminKeypad && (
        <div className="fixed inset-0 z-50">
          <AdminKeypad
            onClose={handleAdminKeypadClose}
            onConfirm={handlePasswordConfirm}
            adminPassword={adminPassword}
          />
        </div>
      )}

      {showPropertyMismatch && mismatchData && (
        <PropertyMismatchDialog
          reservationProperty={mismatchData.reservationProperty}
          kioskProperty={mismatchData.kioskProperty}
          onClose={() => {
            setShowPropertyMismatch(false)
            setCurrentScreen("reservationConfirm")
          }}
          onAdminOverride={handleAdminOverride}
          debugInfo={mismatchData.debugInfo}
        />
      )}

      {showPropertyRedirect && redirectTargetProperty && (
        <PropertyRedirectDialog
          targetProperty={redirectTargetProperty}
          guestName={guestName}
          onClose={() => {
            setShowPropertyRedirect(false)
            setRedirectTargetProperty(null)
            setCurrentScreen("reservationConfirm")
          }}
        />
      )}

      <PrintQueueListener />
    </div>
  )
}

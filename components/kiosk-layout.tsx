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
  propertyUsesElectron,
} from "@/lib/property-utils"
import PropertyMismatchDialog from "@/components/property-mismatch-dialog"
import PropertyRedirectDialog from "@/components/property-redirect-dialog"
import { usePayment } from "@/contexts/payment-context"
import { parseReservationQrValue } from "@/lib/reservation-qr"
import { KioskProgressScreen, RESERVATION_PROGRESS_STEPS } from "@/components/kiosk-progress"

interface KioskLayoutProps {
  onChangeMode: () => void
  initialLocation?: KioskLocation
}

export default function KioskLayout({ onChangeMode, initialLocation }: KioskLayoutProps) {
  const [currentScreen, setCurrentScreen] = useState("onSiteReservation")
  const [homeSessionKey, setHomeSessionKey] = useState(0)
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
  const [kioskLocation, setKioskLocation] = useState<KioskLocation>(() => initialLocation || getKioskLocation())
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

  const { paymentSession, cancelPayment } = usePayment()

  useEffect(() => {
    const savedLocation = initialLocation || getKioskLocation()
    setKioskLocation(savedLocation)

    const savedProperty = getKioskPropertyId()
    setKioskProperty(savedProperty)

    const checkPopupMode = () => {
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search)
        const isPopup = urlParams.get("popup") === "true"
        const property = getKioskPropertyId()
        const isElectronPopup = propertyUsesElectron(property) && !!(window as any).electronAPI && window.opener
        return isPopup || isElectronPopup
      }
      return false
    }

    const popupMode = checkPopupMode()
    setIsPopupMode(popupMode)

    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search)
      const directScreen = urlParams.get("direct")

      if (popupMode && directScreen) {
        setCurrentScreen(directScreen)
      } else if (popupMode) {
        setCurrentScreen("reservationConfirm")
      }
    }

    console.log("[v0] Kiosk initialized:", {
      property: getPropertyDisplayName(savedProperty),
      location: savedLocation,
      isPopupMode: popupMode,
      initialScreen: popupMode ? "reservationConfirm" : "onSiteReservation",
    })
  }, [initialLocation])

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

    const resetTimer = () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
      }

      inactivityTimerRef.current = setTimeout(() => {
        const property = getKioskPropertyId()
        if (propertyUsesElectron(property)) {
          if (typeof window !== "undefined" && (window as any).electronAPI) {
            ; (window as any).electronAPI.send("close-popup")
          }
        } else {
          window.close()
        }
      }, INACTIVITY_TIMEOUT)
    }

    resetTimer()

    const handleUserActivity = () => {
      resetTimer()
    }

    window.addEventListener("click", handleUserActivity)
    window.addEventListener("touchstart", handleUserActivity)
    window.addEventListener("keydown", handleUserActivity)
    window.addEventListener("mousemove", handleUserActivity)

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

  const handleNavigate = async (screen: string) => {
    // 결제 진행 중이면 자동 환불
    if (paymentSession.isActive && paymentSession.acceptedAmount > 0) {
      console.log("[v0] Active payment detected during navigation, initiating refund")
      await cancelPayment()
    }

    stopAllAudio(false)

    const targetScreen =
      !isPopupMode && (screen === "idle" || screen === "standby") ? "onSiteReservation" : screen

    if (targetScreen === "onSiteReservation") {
      setHomeSessionKey((currentKey) => currentKey + 1)
    }

    setCurrentScreen(targetScreen)
    setError("")

    if (
      targetScreen !== "reservationConfirm" &&
      targetScreen !== "reservationDetails" &&
      targetScreen !== "reservationList"
    ) {
      setGuestName("")
    }

    if (targetScreen === "onSiteReservation" || targetScreen === "standby" || targetScreen === "idle") {
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

          setRedirectTargetProperty(targetProperty)
          setShowPropertyRedirect(true)
        } else {
          setCurrentScreen("reservationNotFound")
        }
      }
    } catch (err) {
      console.error("[v0] Reservation check error:", err)
      setError("예약 확인 중 오류가 발생했습니다. 다시 시도해 주세요.")
      setCurrentScreen("reservationNotFound")
    } finally {
      setLoading(false)
    }
  }

  const findReservationById = async (reservationId: string, searchAll = false) => {
    const params = new URLSearchParams({
      reservationId,
      todayOnly: "false",
    })

    if (searchAll) {
      params.set("searchAll", "true")
    } else {
      params.set("kioskProperty", kioskProperty)
    }

    const response = await fetch(`/api/reservations?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    return data.reservations || []
  }

  const handleScanReservationQr = async () => {
    const front = window.electronAPI?.tossFront
    if (!front) {
      setError("토스 프론트는 키오스크 앱에서만 사용할 수 있습니다.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const scanResult = await front.scanReservationQr()
      if (!scanResult.success || !scanResult.value) {
        throw new Error(scanResult.error || "QR 코드를 읽지 못했습니다.")
      }

      const reservationId = parseReservationQrValue(scanResult.value)
      const reservations = await findReservationById(reservationId)

      if (reservations.length === 1) {
        setGuestName(reservations[0].guestName || "")
        setReservationData(reservations[0])
        setCurrentScreen("reservationDetails")
        return
      }

      const allPropertyReservations = await findReservationById(reservationId, true)
      if (allPropertyReservations.length > 0) {
        const foundReservation = allPropertyReservations[0]
        setGuestName(foundReservation.guestName || "")
        setRedirectTargetProperty(foundReservation.property)
        setShowPropertyRedirect(true)
      } else {
        setCurrentScreen("reservationNotFound")
      }
    } catch (err) {
      console.error("[v0] Reservation QR scan error:", err)
      setError(err instanceof Error ? err.message : "QR 예약 확인 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const handleCheckIn = async () => {
    if (!reservationData || !reservationData.reservationId) return false

    setLoading(true)
    setError("")

    try {
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
        return false
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }

      const data = await response.json()

      if (data.data) {
        setRevealedInfo({
          roomNumber: data.data.roomNumber || "",
          password: data.data.password || "",
          floor: data.data.floor || "",
        })
      }

      setAdminOverride(false)

      if (!isPopupMode) {
        setCurrentScreen("checkInComplete")
      }
      return true
    } catch (err) {
      console.error("[v0] Check-in error:", err)
      const message = err instanceof Error ? err.message : "체크인 중 오류가 발생했습니다. 다시 시도해 주세요."
      setError(message)

      if (isPopupMode) {
        alert(message)
      }
      return false
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
      <div className="kiosk-screen-area">
        {error && <div className="m-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

        {currentScreen === "idle" && (
          <IdleScreen onNavigate={handleNavigate} kioskLocation={kioskLocation} imageUrl="/idle-image.jpg" />
        )}

        {currentScreen === "standby" && <StandbyScreen onNavigate={handleNavigate} kioskLocation={kioskLocation} />}

        {currentScreen === "reservationConfirm" && (
          <KioskProgressScreen steps={RESERVATION_PROGRESS_STEPS} currentStep={0}>
            <ReservationConfirm
              onNavigate={handleNavigate}
              onCheckReservation={handleCheckReservation}
              onScanReservationQr={handleScanReservationQr}
              guestName={guestName}
              setGuestName={setGuestName}
              loading={loading}
              kioskLocation={kioskLocation}
              isPopupMode={isPopupMode}
            />
          </KioskProgressScreen>
        )}

        {currentScreen === "reservationList" && (
          <KioskProgressScreen steps={RESERVATION_PROGRESS_STEPS} currentStep={0}>
            <ReservationList
              reservations={reservationsList}
              onSelectReservation={handleSelectReservation}
              onNavigate={handleNavigate}
              kioskLocation={kioskLocation}
              guestName={guestName}
              isPopupMode={isPopupMode}
            />
          </KioskProgressScreen>
        )}

        {currentScreen === "currentLocation" && (
          <CurrentLocation onNavigate={handleNavigate} kioskLocation={kioskLocation} />
        )}

        {currentScreen === "onSiteReservation" && (
          <OnSiteReservation key={homeSessionKey} onNavigate={handleNavigate} location={kioskLocation} />
        )}

        {currentScreen === "reservationDetails" && (
          <KioskProgressScreen
            steps={RESERVATION_PROGRESS_STEPS}
            currentStep={loading || !!(revealedInfo.roomNumber || revealedInfo.password) ? 2 : 0}
          >
            <ReservationDetails
              reservation={reservationData}
              onCheckIn={handleCheckIn}
              onNavigate={handleNavigate}
              loading={loading}
              revealedInfo={revealedInfo}
              isPopupMode={isPopupMode}
              kioskLocation={kioskLocation}
            />
          </KioskProgressScreen>
        )}

        {currentScreen === "checkInComplete" && (
          <KioskProgressScreen steps={RESERVATION_PROGRESS_STEPS} currentStep={2}>
            <CheckInComplete
              reservation={reservationData}
              revealedInfo={revealedInfo}
              kioskLocation={kioskLocation}
              onNavigate={handleNavigate}
              isPopupMode={isPopupMode}
            />
          </KioskProgressScreen>
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
        <div className="kiosk-admin-slot absolute top-2 right-2 z-20">
          <button
            className="kiosk-admin-entry"
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

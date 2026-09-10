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
import { type KioskScope, buildingRestrictionMessage } from "@/lib/kiosk-scope"
import type { Reservation } from "@/lib/types"

interface KioskLayoutProps {
  onChangeMode: () => void
  initialLocation?: KioskLocation
}

function getReservations(data: { reservations?: unknown } | null): Reservation[] {
  const reservations = data?.reservations
  if (!Array.isArray(reservations) || reservations.some(value => !value || typeof value.reservationId !== "string" ||
      !value.reservationId.trim() || typeof value.guestName !== "string")) throw new Error("Invalid reservation lookup response")
  return reservations
}

export default function KioskLayout({ onChangeMode, initialLocation }: KioskLayoutProps) {
  const [currentScreen, setCurrentScreen] = useState("onSiteReservation")
  const [homeSessionKey, setHomeSessionKey] = useState(0)
  const [reservationData, setReservationData] = useState<Reservation | null>(null)
  const [reservationsList, setReservationsList] = useState<Reservation[]>([])
  const [guestName, setGuestName] = useState("")
  const [loading, setLoading] = useState(false)
  const [onSiteUpdateSafe, setOnSiteUpdateSafe] = useState(false)
  const [error, setError] = useState("")
  const [lookupError, setLookupError] = useState(false)
  const [checkInPending, setCheckInPending] = useState(false)
  const checkInSubmitting = useRef(false)
  const lookupSubmitting = useRef(false)
  const [revealedInfo, setRevealedInfo] = useState({
    roomNumber: "",
    password: "",
    floor: "",
  })
  const [showAdminKeypad, setShowAdminKeypad] = useState(false)
  const [kioskLocation, setKioskLocation] = useState<KioskLocation>(() => initialLocation || getKioskLocation())
  const [isPopupMode, setIsPopupMode] = useState(false)
  const [kioskProperty, setKioskProperty] = useState<PropertyId>("property3")
  const [kioskScope, setKioskScope] = useState<KioskScope | null>(null)
  const [configError, setConfigError] = useState("")
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

  const { paymentSession, storageError, ready } = usePayment()

  useEffect(() => {
    window.electronAPI?.setUpdateSafe?.(
      ready && !storageError && !checkInPending && !!kioskScope && currentScreen === "onSiteReservation" && onSiteUpdateSafe && !loading &&
      !paymentSession.isActive && !showAdminKeypad && !showPropertyMismatch && !showPropertyRedirect,
    )
    return () => window.electronAPI?.setUpdateSafe?.(false)
  }, [kioskScope, currentScreen, onSiteUpdateSafe, loading, paymentSession.isActive, showAdminKeypad, showPropertyMismatch, showPropertyRedirect, ready, storageError, checkInPending])

  useEffect(() => {
    let cancelled = false
    setKioskScope(null)
    setConfigError("")
    const initialize = async () => {
      const response = await fetch("/api/kiosk-config", { cache: "no-store" })
      const config = await response.json()
      if (!response.ok) throw new Error(config.error || "키오스크 PC 설정을 확인하지 못했습니다.")
      if (cancelled) return
      const scope = config as KioskScope
      const savedLocation = scope.building || initialLocation || getKioskLocation()
      setKioskLocation(savedLocation)

      const savedProperty = scope.property
      setKioskProperty(savedProperty)

      const checkPopupMode = () => {
        if (typeof window !== "undefined") {
          const urlParams = new URLSearchParams(window.location.search)
          const isPopup = urlParams.get("popup") === "true"
          const property = savedProperty
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
      setKioskScope(scope)
    }
    initialize().catch((error) => {
      if (!cancelled) setConfigError(error instanceof Error ? error.message : "키오스크 PC 설정을 확인하지 못했습니다.")
    })
    return () => { cancelled = true }
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
    if (!isPopupMode || paymentSession.isActive || loading || checkInPending) return

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
  }, [isPopupMode, paymentSession.isActive, loading, checkInPending])

  const handleNavigate = async (screen: string) => {
    // A navigation is never proof that cash was returned or an approval was cancelled.
    if (paymentSession.isActive || checkInSubmitting.current || checkInPending || lookupSubmitting.current) return

    stopAllAudio(false)

    const targetScreen =
      !isPopupMode && (screen === "idle" || screen === "standby") ? "onSiteReservation" : screen

    if (targetScreen === "onSiteReservation") {
      setHomeSessionKey((currentKey) => currentKey + 1)
    }

    setCurrentScreen(targetScreen)
    setError("")
    setLookupError(false)

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
    if (paymentSession.isActive || checkInSubmitting.current || checkInPending) {
      alert("진행 중인 결제/체크인 확인을 먼저 완료해주세요. 관리자 문의 010-5126-4644")
      return
    }
    setShowAdminKeypad(true)
  }

  const handlePasswordConfirm = (password: string) => {
    setShowAdminKeypad(false)
    onChangeMode()
  }

  const handleAdminKeypadClose = () => {
    setShowAdminKeypad(false)
  }

  const handleCheckReservation = async (name: string) => {
    if (!name.trim() || lookupSubmitting.current) return
    lookupSubmitting.current = true

    setLoading(true)
    setError("")
    setLookupError(false)

    try {
      const response = await fetch(
        `/api/reservations?name=${encodeURIComponent(name)}&todayOnly=false&kioskProperty=${kioskProperty}`,
        {
          method: "GET",
          signal: AbortSignal.timeout(15000),
        },
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      data.reservations = getReservations(data)

      if (data.reservations && data.reservations.length > 0) {
        if (data.reservations.length > 1) {
          setReservationsList(data.reservations)
          setCurrentScreen("reservationList")
        } else {
          const reservation = data.reservations[0]
          setReservationData(reservation)
          setCurrentScreen("reservationDetails")
        }
      } else if (kioskScope?.building) {
        setError(buildingRestrictionMessage(kioskScope.building))
        setCurrentScreen("reservationNotFound")
      } else {
        const allPropertiesResponse = await fetch(
          `/api/reservations?name=${encodeURIComponent(name)}&todayOnly=false&searchAll=true`,
          {
            method: "GET",
            signal: AbortSignal.timeout(15000),
          },
        )

        if (!allPropertiesResponse.ok) {
          throw new Error(`API error: ${allPropertiesResponse.status}`)
        }

        const allPropertiesData = await allPropertiesResponse.json()
        allPropertiesData.reservations = getReservations(allPropertiesData)

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
      setLookupError(true)
      setCurrentScreen("reservationNotFound")
    } finally {
      lookupSubmitting.current = false
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

    const response = await fetch(`/api/reservations?${params.toString()}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    return getReservations(data)
  }

  const handleScanReservationQr = async () => {
    if (lookupSubmitting.current) return
    const front = window.electronAPI?.tossFront
    if (!front) {
      setError("토스 프론트는 키오스크 앱에서만 사용할 수 있습니다.")
      return
    }

    lookupSubmitting.current = true
    setLookupError(false)
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

      if (kioskScope?.building) {
        setError(buildingRestrictionMessage(kioskScope.building))
        setCurrentScreen("reservationNotFound")
        return
      }
      const allPropertyReservations = await findReservationById(reservationId, true)
      if (allPropertyReservations.length > 0) {
        const foundReservation = allPropertyReservations[0]
        if (!foundReservation.property) throw new Error("예약 숙소 정보를 확인하지 못했습니다.")
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
      lookupSubmitting.current = false
      setLoading(false)
    }
  }

  const handleCheckIn = async (override = adminOverride) => {
    if (!reservationData?.reservationId || checkInSubmitting.current) return false
    checkInSubmitting.current = true

    setLoading(true)
    setError("")
    let definitiveFailure = false

    try {
      const response = await fetch("/api/check-in", {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: reservationData.reservationId,
          kioskProperty: kioskProperty,
          adminOverride: override,
        }),
      })

      if (response.status === 403) {
        definitiveFailure = true
        const errorData = await response.json()
        if (errorData.error === "KIOSK_BUILDING_MISMATCH") throw new Error(errorData.message)

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
        definitiveFailure = response.status >= 400 && response.status < 500
        const errorData = await response.json()
        throw new Error(errorData.message || "체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }

      const data = await response.json()

      if (response.status === 202 || data.pending || data.success !== true || !data.data) {
        setCheckInPending(true)
        setError(data.message || data.error || "체크인 처리 결과 확인이 필요합니다. 같은 예약으로 다시 확인해주세요.")
        return false
      }

      if (data.data) {
        setRevealedInfo({
          roomNumber: data.data.roomNumber || "",
          password: data.data.password || "",
          floor: data.data.floor || "",
        })
      }

      setAdminOverride(false)
      setCheckInPending(false)

      if (!isPopupMode) {
        setCurrentScreen("checkInComplete")
      }
      return true
    } catch (err) {
      console.error("[v0] Check-in error:", err)
      const message = err instanceof Error ? err.message : "체크인 중 오류가 발생했습니다. 다시 시도해 주세요."
      if (!definitiveFailure) setCheckInPending(true)
      setError(message)

      if (isPopupMode) {
        alert(message)
      }
      return false
    } finally {
      checkInSubmitting.current = false
      setLoading(false)
    }
  }

  const handleSelectReservation = (reservation: Reservation) => {
    setReservationData(reservation)
    setCurrentScreen("reservationDetails")
  }

  const handleAdminOverride = () => {
    setShowPropertyMismatch(false)
    setAdminOverride(true)
    void handleCheckIn(true)
  }

  if (!kioskScope) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center text-2xl" role="status">
        <p>{configError || "키오스크 PC 설정을 확인하고 있습니다."}</p>
        {configError && <button className="rounded border p-4" onClick={() => window.location.reload()}>다시 확인</button>}
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-[#fefef7] overflow-hidden kiosk-mode relative">
      <div className="kiosk-screen-area">
        {error && <div className="m-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}
        {checkInPending && <button className="m-4 rounded border p-5 text-xl" disabled={loading} onClick={() => handleCheckIn()}>
          {loading ? "체크인 결과 확인 중..." : "이 예약의 체크인 처리 결과 다시 확인"}
        </button>}

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
          <OnSiteReservation key={homeSessionKey} onNavigate={handleNavigate} location={kioskLocation} onUpdateSafeChange={setOnSiteUpdateSafe} />
        )}

        {currentScreen === "reservationDetails" && reservationData && (
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

        {currentScreen === "checkInComplete" && reservationData && (
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
            onRecheck={() => { setError(""); setLookupError(false); setCurrentScreen("reservationConfirm") }}
            onNavigate={handleNavigate}
            kioskLocation={kioskLocation}
            isPopupMode={isPopupMode}
            lookupFailed={lookupError}
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

      <PrintQueueListener scope={kioskScope} />
    </div>
  )
}

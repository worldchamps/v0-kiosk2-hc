"use client"

import { Check, ReceiptText, MapPin } from "lucide-react"
import { useEffect, useState, useRef } from "react"
import { printReceipt, getPrinterModel, isPrinterConnected, autoConnectPrinter } from "@/lib/printer-utils-unified"
import Image from "next/image"
import { getBuildingZoomImagePath } from "@/lib/location-utils"
import type { KioskLocation } from "@/lib/location-utils"
import { playCheckInGuide, stopAllAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { getKioskPropertyId, propertyUsesElectron } from "@/lib/property-utils"

interface CheckInCompleteProps {
  reservation?: any
  revealedInfo?: {
    roomNumber: string
    password: string
    floor: string
  }
  kioskLocation?: KioskLocation
  onNavigate?: (screen: string) => void
  isPopupMode?: boolean
}

export default function CheckInComplete({
  reservation,
  revealedInfo,
  kioskLocation,
  onNavigate,
  isPopupMode = false,
}: CheckInCompleteProps) {
  const [countdown, setCountdown] = useState<number | null>(null)
  const [autoPrintAttempted, setAutoPrintAttempted] = useState(false)
  const [printStatus, setPrintStatus] = useState<"idle" | "printing" | "success" | "error">("idle")
  const [simpleMode, setSimpleMode] = useState(false)
  const [printerModel, setPrinterModel] = useState<string>("UNKNOWN")
  const [audioPlayed, setAudioPlayed] = useState(false)

  const printTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioTimerRef = useRef<NodeJS.Timeout | null>(null)

  const logDebug = (message: string) => {
    console.log(`[CheckInComplete] ${message}`)
  }

  const roomNumber = revealedInfo?.roomNumber || reservation?.roomNumber || ""
  const buildingZoomImagePath = getBuildingZoomImagePath(roomNumber)

  const getBuildingType = (): string => {
    if (!roomNumber || roomNumber.length === 0) return ""

    if (roomNumber.startsWith("Camp")) return "CAMP"
    if (roomNumber.startsWith("Kariv")) return "KARIV"

    return roomNumber.charAt(0).toUpperCase()
  }

  const receiptData = reservation
    ? {
        guestName: reservation.guestName || "",
        roomNumber: revealedInfo?.roomNumber || reservation.roomNumber || "",
        roomType: reservation.roomType || "",
        checkInDate: reservation.checkInDate || "",
        checkOutDate: reservation.checkOutDate || "",
        price: reservation.price || "",
        reservationId: reservation.reservationId || "",
        password: revealedInfo?.password || reservation.password || "",
        floor: revealedInfo?.floor || reservation.floor || "",
        paymentReceipt: reservation.paymentReceipt || null,
        timestamp: new Date().toLocaleString("en-US"),
      }
    : {
        guestName: "Guest",
        roomNumber: revealedInfo?.roomNumber || "000",
        roomType: "Room",
        checkInDate: new Date().toLocaleDateString("en-US"),
        checkOutDate: new Date().toLocaleDateString("en-US"),
        reservationId: "R00000",
        password: revealedInfo?.password || "",
        floor: revealedInfo?.floor || "",
        paymentReceipt: null,
      }

  useEffect(() => {
    logDebug("Component mounted with new reservation data")
    logDebug(`Popup mode: ${isPopupMode}`)

    setPrintStatus("idle")
    setAutoPrintAttempted(false)
    setAudioPlayed(false)

    const forceSimple = process.env.NEXT_PUBLIC_FORCE_SIMPLE_MODE === "true"
    const currentSimpleMode = forceSimple || true // Changed to true for default simple mode
    setSimpleMode(currentSimpleMode)
    setPrinterModel(getPrinterModel())

    logDebug(`Force simple mode from env: ${forceSimple}`)
    logDebug(`Final simple mode setting: ${currentSimpleMode}`)

    const buildingType = getBuildingType()
    if (buildingType) {
      logDebug(`Building type detected: ${buildingType}`)

      audioTimerRef.current = setTimeout(() => {
        logDebug(`Playing check-in guide audio for ${roomNumber || buildingType}`)
        playCheckInGuide(roomNumber, buildingType)
        setAudioPlayed(true)
      }, 1000)
    } else {
      logDebug("No building type detected")
    }

    return () => {
      logDebug("Component unmounting: clearing all timers")
      clearAllTimers()
      stopAllAudio()
    }
  }, [reservation?.reservationId, revealedInfo?.roomNumber, isPopupMode])

  const clearAllTimers = () => {
    if (printTimerRef.current) {
      logDebug(`Clearing print timer: ${printTimerRef.current}`)
      clearTimeout(printTimerRef.current)
      printTimerRef.current = null
    }

    if (countdownTimerRef.current) {
      logDebug(`Clearing countdown timer: ${countdownTimerRef.current}`)
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }

    if (redirectTimerRef.current) {
      logDebug(`Clearing redirect timer: ${redirectTimerRef.current}`)
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
    }

    if (audioTimerRef.current) {
      logDebug(`Clearing audio timer: ${audioTimerRef.current}`)
      clearTimeout(audioTimerRef.current)
      audioTimerRef.current = null
    }
  }

  useEffect(() => {
    if (isPopupMode) {
      logDebug("Popup mode: skipping auto print")
      setAutoPrintAttempted(true)
      setPrintStatus("idle")
      startRedirectCountdown()
      return
    }

    if (autoPrintAttempted) return

    logDebug("Setting up auto print timer (1 second)")

    if (printTimerRef.current) {
      clearTimeout(printTimerRef.current)
    }

    printTimerRef.current = setTimeout(() => {
      logDebug("Starting auto print")
      autoPrintReceipt()
    }, 1000)

    return () => {
      if (printTimerRef.current) {
        logDebug("Clearing print timer")
        clearTimeout(printTimerRef.current)
        printTimerRef.current = null
      }
    }
  }, [autoPrintAttempted, isPopupMode])

  const autoPrintReceipt = async () => {
    setAutoPrintAttempted(true)
    setPrintStatus("printing")
    logDebug("Print status: printing")
    logDebug(`Print mode: ${simpleMode ? "simple mode" : "normal mode"}`)
    logDebug(`Printer model: ${printerModel}`)

    const isConnected = isPrinterConnected()
    logDebug(`Printer connected: ${isConnected}`)

    if (!isConnected) {
      logDebug("Printer not connected. Attempting auto-connect...")
      const connected = await autoConnectPrinter()
      logDebug(`Auto-connect result: ${connected}`)

      if (!connected) {
        setPrintStatus("error")
        logDebug("Print status: error (connection failed)")
        return
      }
    }

    try {
      logDebug("Calling printReceipt function...")
      const success = await printReceipt(receiptData)
      logDebug(`printReceipt result: ${success}`)

      if (success) {
        setPrintStatus("success")
        logDebug(`Print status: success (${simpleMode ? "simple mode" : "normal mode"})`)

        startRedirectCountdown()
      } else {
        setPrintStatus("error")
        logDebug("Print status: error (print failed)")
      }
    } catch (error) {
      console.error("Auto print receipt error:", error)
      setPrintStatus("error")
      logDebug(`Print status: error (${error})`)
    }
  }

  const startRedirectCountdown = () => {
    clearAllTimers()

    const countdownSeconds = isPopupMode ? 10 : 25
    setCountdown(countdownSeconds)
    logDebug(`Starting ${countdownSeconds}-second countdown (popup mode: ${isPopupMode})`)

    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 0) return 0
        return prev - 1
      })
    }, 1000)

    redirectTimerRef.current = setTimeout(() => {
      logDebug("Executing redirect")
      handleRedirect()
    }, countdownSeconds * 1000)
  }

  const handleRedirect = () => {
    if (isPopupMode) {
      const property = getKioskPropertyId()
      if (propertyUsesElectron(property)) {
        logDebug("Popup mode: notifying Electron to close popup")
        if (typeof window !== "undefined" && (window as any).electronAPI) {
          ;(window as any).electronAPI.send("checkin-complete")
        }
      } else {
        logDebug("Property3,4: closing window directly")
        window.close()
      }
    } else {
      if (onNavigate) {
        onNavigate("standby")
      } else {
        window.location.href = "/loading?redirect=/"
      }
    }
  }

  useEffect(() => {
    if (countdown !== null) {
      logDebug(`Countdown: ${countdown} seconds`)
    }
  }, [countdown])

  const buildingName = roomNumber && roomNumber.length > 0 ? `${roomNumber.charAt(0)}동` : ""

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] Check-in complete idle, navigating to idle screen")
      clearAllTimers()
      stopAllAudio()
      if (onNavigate) {
        onNavigate("idle")
      }
    },
    idleTime: 60000,
    enabled: !isPopupMode,
  })

  return (
    <main className="kiosk-complete-screen">
      <header className="kiosk-complete-header">
        <span><Check /></span>
        <p>결제와 체크인이 완료되었습니다</p>
        <h1>객실 정보를 확인해주세요</h1>
      </header>

      {revealedInfo && (
        <section className="kiosk-complete-room">
          <div>
            <span>객실번호</span>
            <strong>{revealedInfo.roomNumber}호</strong>
          </div>
          <div>
            <span>객실 비밀번호</span>
            <strong>{revealedInfo.password || "관리자에게 문의해주세요"}</strong>
          </div>
        </section>
      )}

      <section className="kiosk-complete-notice" role="alert">
        <ReceiptText aria-hidden="true" />
        <div>
          <h2>객실 안내지를 꼭 가져가세요</h2>
          <p>{revealedInfo?.password ? "객실번호와 비밀번호가 적혀 있습니다." : "객실번호를 확인하고 입실 방법은 관리자에게 문의해주세요."}</p>
        </div>
      </section>

      <section className="kiosk-complete-map">
        <div>
          <MapPin aria-hidden="true" />
          <h2>{buildingName} 위치</h2>
        </div>
        <div className="kiosk-complete-map-image">
          <Image
            src={buildingZoomImagePath || "/placeholder.svg"}
            alt={`${buildingName} 건물 위치`}
            fill
            className="object-contain"
            priority
          />
        </div>
      </section>

      <div className={`kiosk-complete-print-status is-${printStatus}`}>
        {printStatus === "printing" && "객실 안내지를 인쇄하고 있습니다."}
        {printStatus === "success" && "객실 안내지가 인쇄되었습니다."}
        {printStatus === "error" && "안내지를 인쇄하지 못했습니다. 관리자에게 문의해주세요."}
      </div>

      <div className="kiosk-complete-actions">
        <button
          type="button"
          className="is-primary"
          onClick={() => {
            logDebug("Back button clicked: clearing all timers")
            clearAllTimers()
            stopAllAudio()
            handleRedirect()
          }}
        >
          {isPopupMode ? "닫기" : "처음 화면으로"}
        </button>
      </div>

      {countdown !== null && printStatus === "success" && (
        <p className="kiosk-complete-countdown">
          {isPopupMode
            ? `${countdown}초 후 자동으로 창이 닫힙니다.`
            : `${countdown}초 후 자동으로 처음 화면으로 돌아갑니다.`}
        </p>
      )}

    </main>
  )
}

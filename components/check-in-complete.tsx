"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check, Printer, Eye, EyeOff, Banknote, Loader2 } from "lucide-react"
import { useEffect, useState, useRef } from "react"
import DirectPrinter from "./direct-printer"
import { printReceipt, getSimplePrintMode, autoConnectPrinter, getPrinterModel } from "@/lib/printer-utils-unified"
import Image from "next/image"
import { getBuildingZoomImagePath } from "@/lib/location-utils"
import type { KioskLocation } from "@/lib/location-utils"
import { playBuildingGuide, stopAllAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { getKioskPropertyId, propertyUsesElectron } from "@/lib/property-utils"
import { usePayment } from "@/contexts/payment-context"
import { connectBillDispenser, dispenseBills, isBillDispenserConnected } from "@/lib/bill-dispenser-utils"

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
  const [showPrinter, setShowPrinter] = useState(false)
  const [autoPrintAttempted, setAutoPrintAttempted] = useState(false)
  const [printStatus, setPrintStatus] = useState<"idle" | "connecting" | "printing" | "success" | "error">("idle")
  const [showPassword, setShowPassword] = useState(false)
  const [simpleMode, setSimpleMode] = useState(false)
  const [printerModel, setPrinterModel] = useState<string>("UNKNOWN")
  const [audioPlayed, setAudioPlayed] = useState(false)
  const { paymentSession } = usePayment()
  const [isRefundingChange, setIsRefundingChange] = useState(false)
  const [refundStatus, setRefundStatus] = useState<"idle" | "connecting" | "dispensing" | "success" | "error">("idle")
  const [changeAmount, setChangeAmount] = useState(0)
  const changeRefundedRef = useRef(false)

  const printTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [debugInfo, setDebugInfo] = useState<string[]>([])

  const logDebug = (message: string) => {
    console.log(`[CheckInComplete] ${message}`)
    setDebugInfo((prev) => [...prev, `${new Date().toISOString().substr(11, 8)}: ${message}`])
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
      }

  useEffect(() => {
    logDebug("Component mounted with new reservation data")
    logDebug(`Popup mode: ${isPopupMode}`)

    setPrintStatus("idle")
    setAutoPrintAttempted(false)
    setAudioPlayed(false)

    setSimpleMode(getSimplePrintMode())
    setPrinterModel(getPrinterModel())

    const buildingType = getBuildingType()
    if (buildingType) {
      logDebug(`Building type detected: ${buildingType}`)

      audioTimerRef.current = setTimeout(() => {
        logDebug(`Playing building guide audio for ${buildingType}`)
        playBuildingGuide(buildingType)
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
    setPrintStatus("connecting")
    logDebug("Print status: connecting")
    logDebug(`Print mode: ${simpleMode ? "simple mode" : "normal mode"}`)
    logDebug(`Printer model: ${printerModel}`)

    try {
      const connected = await autoConnectPrinter()

      if (connected) {
        setPrinterModel(getPrinterModel())
        logDebug(`Connected printer model: ${getPrinterModel()}`)

        setPrintStatus("printing")
        logDebug("Print status: printing")

        const success = await printReceipt(receiptData)

        if (success) {
          setPrintStatus("success")
          logDebug(`Print status: success (${simpleMode ? "simple mode" : "normal mode"})`)

          startRedirectCountdown()
        } else {
          setPrintStatus("error")
          logDebug("Print status: error (print failed)")
        }

        // await disconnectPrinter()
      } else {
        setPrintStatus("error")
        logDebug("Print status: error (connection failed)")
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

  useEffect(() => {
    const handleChangeRefund = async () => {
      if (paymentSession.overpaymentAmount > 0 && !changeRefundedRef.current) {
        changeRefundedRef.current = true
        setChangeAmount(paymentSession.overpaymentAmount)
        setIsRefundingChange(true)
        setRefundStatus("connecting")
        logDebug(`Overpayment detected: ${paymentSession.overpaymentAmount}원`)

        try {
          if (!isBillDispenserConnected()) {
            logDebug("Connecting to bill dispenser...")
            const connected = await connectBillDispenser()
            if (!connected) {
              logDebug("Failed to connect to bill dispenser")
              setRefundStatus("error")
              setIsRefundingChange(false)
              return
            }
          }

          logDebug("Bill dispenser connected")
          setRefundStatus("dispensing")

          const billCount = Math.floor(paymentSession.overpaymentAmount / 10000)
          logDebug(`Dispensing ${billCount} bills of 10,000 won`)

          const success = await dispenseBills(billCount)

          if (success) {
            logDebug("Change refunded successfully")
            setRefundStatus("success")
          } else {
            logDebug("Failed to dispense change")
            setRefundStatus("error")
          }
        } catch (error) {
          console.error("Change refund error:", error)
          logDebug(`Change refund error: ${error}`)
          setRefundStatus("error")
        } finally {
          setIsRefundingChange(false)
        }
      }
    }

    handleChangeRefund()
  }, [paymentSession.overpaymentAmount])

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">더 비치스테이 {kioskLocation === "CAMP" ? "" : kioskLocation + "동"}</h1>
          <div className="kiosk-highlight">체크인 완료</div>
        </div>

        <div className="w-full mt-6">
          <Card className="w-full shadow-md">
            <CardContent className="p-8 flex flex-col items-start justify-start space-y-6">
              <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="h-10 w-10 text-green-600" />
              </div>

              <p className="text-left text-2xl font-bold">체크인 과정이 완료되었습니다.</p>
              <p className="text-left text-xl font-bold">객실 번호와 비밀번호를 기억해 주세요.</p>

              {revealedInfo && (
                <div className="w-full bg-blue-50 rounded-lg p-6 mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-gray-500 font-bold">객실 호수</p>
                      <p className="text-3xl font-bold text-blue-600">{revealedInfo.roomNumber}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-bold">비밀번호</p>
                      <div className="flex items-center">
                        <p className="text-3xl font-bold text-red-600">
                          {showPassword ? revealedInfo.password : revealedInfo.password.replace(/./g, "•")}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2 h-8 w-8 p-0"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                          <span className="sr-only">{showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="w-full mt-4">
                <p className="text-gray-500 font-bold mb-2">{buildingName} 위치</p>
                <div className="bg-gray-100 rounded-lg w-full h-[40vh] relative overflow-hidden p-0">
                  <Image
                    src={buildingZoomImagePath || "/placeholder.svg"}
                    alt={`${buildingName} 건물 위치`}
                    fill
                    className="object-contain p-0 m-0"
                    priority
                  />
                </div>
              </div>

              <div className="w-full">
                {printStatus === "connecting" && (
                  <div className="bg-blue-50 p-4 rounded-lg text-blue-700">COM2 프린터에 연결 중입니다...</div>
                )}
                {printStatus === "printing" && (
                  <div className="bg-blue-50 p-4 rounded-lg text-blue-700">영수증을 인쇄하고 있습니다...</div>
                )}
                {printStatus === "success" && (
                  <div className="bg-green-50 p-4 rounded-lg text-green-700">영수증이 성공적으로 인쇄되었습니다.</div>
                )}
                {printStatus === "error" && (
                  <div className="bg-yellow-50 p-4 rounded-lg text-yellow-700">
                    자동 인쇄에 실패했습니다. 아래 버튼을 눌러 수동으로 인쇄해 주세요.
                  </div>
                )}
              </div>

              {changeAmount > 0 && (
                <div className="w-full">
                  {refundStatus === "connecting" && (
                    <div className="bg-blue-50 p-4 rounded-lg flex items-center gap-3">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                      <span className="text-blue-700 font-semibold">
                        거스름돈 반환을 위해 지폐 방출기에 연결 중입니다...
                      </span>
                    </div>
                  )}
                  {refundStatus === "dispensing" && (
                    <div className="bg-blue-50 p-4 rounded-lg flex items-center gap-3">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                      <span className="text-blue-700 font-semibold">
                        거스름돈 {changeAmount.toLocaleString()}원을 반환하고 있습니다...
                      </span>
                    </div>
                  )}
                  {refundStatus === "success" && (
                    <div className="bg-green-50 p-4 rounded-lg flex items-center gap-3">
                      <Banknote className="h-6 w-6 text-green-600" />
                      <span className="text-green-700 font-semibold">
                        거스름돈 {changeAmount.toLocaleString()}원이 반환되었습니다.
                      </span>
                    </div>
                  )}
                  {refundStatus === "error" && (
                    <div className="bg-red-50 p-4 rounded-lg">
                      <span className="text-red-700 font-semibold">
                        거스름돈 반환에 실패했습니다. 관리자에게 문의해주세요. (거스름돈:{" "}
                        {changeAmount.toLocaleString()}원)
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="w-full flex justify-between mt-6">
                {!isPopupMode && (
                  <Button
                    className="h-20 text-2xl text-black bg-[#42c0ff] hover:bg-[#3ab0e8] shadow-md font-bold rounded-xl flex items-center space-x-2 px-6"
                    onClick={() => setShowPrinter(true)}
                  >
                    <Printer className="h-6 w-6" />
                    <span>영수증 인쇄</span>
                  </Button>
                )}

                <Button
                  variant="outline"
                  className="h-20 text-2xl border-3 border-gray-300 font-bold rounded-xl bg-transparent px-6"
                  onClick={() => {
                    logDebug("Back button clicked: clearing all timers")
                    clearAllTimers()
                    stopAllAudio()
                    handleRedirect()
                  }}
                >
                  {isPopupMode ? "닫기" : "돌아가기"}
                </Button>
              </div>

              {countdown !== null && printStatus === "success" && (
                <div className="w-full bg-gray-100 rounded-lg p-4 mt-4">
                  <p className="text-left text-sm text-gray-500 font-bold">
                    {isPopupMode
                      ? `${countdown}초 후 자동으로 창이 닫힙니다.`
                      : `${countdown}초 후 자동으로 대기 화면으로 돌아갑니다.`}
                  </p>
                </div>
              )}

              {audioPlayed && (
                <div className="w-full bg-blue-50 rounded-lg p-4 mt-2">
                  <p className="text-left text-sm text-blue-600 font-bold">
                    {getBuildingType()} 건물 안내 음성이 재생되었습니다.
                  </p>
                </div>
              )}

              <div className="w-full mt-2 text-xs text-gray-400 border-t pt-2">
                <p>Print Status: {printStatus}</p>
                <p>Print Mode: {simpleMode ? "Simple" : "Formatted"}</p>
                <p>Printer Model: {printerModel}</p>
                <p>Building Type: {getBuildingType()}</p>
                <p>Audio Played: {audioPlayed ? "Yes" : "No"}</p>
                <p>Popup Mode: {isPopupMode ? "Yes" : "No"}</p>
                {countdown !== null && <p>Countdown: {countdown}s</p>}
                <details>
                  <summary>Debug Logs</summary>
                  <div className="max-h-32 overflow-y-auto text-xs">
                    {debugInfo.map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </details>
              </div>
            </CardContent>
          </Card>
        </div>

        {showPrinter && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <DirectPrinter receiptData={receiptData} onClose={() => setShowPrinter(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

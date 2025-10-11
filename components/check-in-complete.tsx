"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check, Printer, Eye, EyeOff } from "lucide-react"
import { useEffect, useState, useRef } from "react"
import DirectPrinter from "./direct-printer"
import {
  printReceipt,
  disconnectPrinter,
  getSimplePrintMode,
  autoConnectPrinter,
  getPrinterModel,
} from "@/lib/printer-utils"
import Image from "next/image"
import { getBuildingZoomImagePath } from "@/lib/location-utils"
import type { KioskLocation } from "@/lib/location-utils"
import { playBuildingGuide, stopAllAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"

interface CheckInCompleteProps {
  reservation?: any
  revealedInfo?: {
    roomNumber: string
    password: string
    floor: string
  }
  kioskLocation?: KioskLocation
  onNavigate?: (screen: string) => void
}

export default function CheckInComplete({
  reservation,
  revealedInfo,
  kioskLocation,
  onNavigate,
}: CheckInCompleteProps) {
  const [countdown, setCountdown] = useState<number | null>(null)
  const [showPrinter, setShowPrinter] = useState(false)
  const [autoPrintAttempted, setAutoPrintAttempted] = useState(false)
  const [printStatus, setPrintStatus] = useState<"idle" | "connecting" | "printing" | "success" | "error">("idle")
  const [showPassword, setShowPassword] = useState(false)
  const [simpleMode, setSimpleMode] = useState(false)
  const [printerModel, setPrinterModel] = useState<string>("UNKNOWN")
  const [audioPlayed, setAudioPlayed] = useState(false) // 음성 재생 여부 추적

  // Timers refs to properly clean up
  const printTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioTimerRef = useRef<NodeJS.Timeout | null>(null) // 음성 재생 타이머

  // Debug info
  const [debugInfo, setDebugInfo] = useState<string[]>([])

  // Debug log function
  const logDebug = (message: string) => {
    console.log(`[CheckInComplete] ${message}`)
    setDebugInfo((prev) => [...prev, `${new Date().toISOString().substr(11, 8)}: ${message}`])
  }

  // Room number based on building zoom image path
  const roomNumber = revealedInfo?.roomNumber || reservation?.roomNumber || ""
  const buildingZoomImagePath = getBuildingZoomImagePath(roomNumber)

  // 건물 타입 추출 (A, B, C, D, CAMP)
  const getBuildingType = (): string => {
    if (!roomNumber || roomNumber.length === 0) return ""

    if (roomNumber.startsWith("Camp")) return "CAMP"
    if (roomNumber.startsWith("Kariv")) return "KARIV"

    // 첫 글자가 건물 타입 (A, B, C, D 등)
    return roomNumber.charAt(0).toUpperCase()
  }

  // Receipt data preparation
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

  // Component mount - clean up all timers
  useEffect(() => {
    logDebug("Component mounted with new reservation data")

    // Reset print status when component mounts with new data
    setPrintStatus("idle")
    setAutoPrintAttempted(false)
    setAudioPlayed(false) // 음성 재생 상태 초기화

    // Load simple mode preference on component mount
    setSimpleMode(getSimplePrintMode())
    setPrinterModel(getPrinterModel())

    // 체크인 완료 후 1초 후에 건물 안내 음성 재생
    const buildingType = getBuildingType()
    if (buildingType) {
      logDebug(`Building type detected: ${buildingType}`)

      // 음성 재생 타이머 설정 (1초 후)
      audioTimerRef.current = setTimeout(() => {
        logDebug(`Playing building guide audio for ${buildingType}`)
        playBuildingGuide(buildingType)
        setAudioPlayed(true)
      }, 1000)
    } else {
      logDebug("No building type detected")
    }

    // Clean up all timers on unmount
    return () => {
      logDebug("Component unmounting: clearing all timers")
      clearAllTimers()
      stopAllAudio() // 모든 오디오 중지
    }
  }, [reservation?.reservationId, revealedInfo?.roomNumber])

  // Clear all timers function
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

  // Auto print receipt attempt
  useEffect(() => {
    // Don't try again if already attempted
    if (autoPrintAttempted) return

    logDebug("Setting up auto print timer (1 second)")

    // Clear existing timer if any
    if (printTimerRef.current) {
      clearTimeout(printTimerRef.current)
    }

    // Try auto printing 1 second after check-in completion
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
  }, [autoPrintAttempted])

  // Auto print function
  const autoPrintReceipt = async () => {
    setAutoPrintAttempted(true)
    setPrintStatus("connecting")
    logDebug("Print status: connecting")
    logDebug(`Print mode: ${simpleMode ? "simple mode" : "normal mode"}`)
    logDebug(`Printer model: ${printerModel}`)

    try {
      // Try to auto-connect to previously used printer first
      const connected = await autoConnectPrinter()

      if (connected) {
        // Update printer model after connection
        setPrinterModel(getPrinterModel())
        logDebug(`Connected printer model: ${getPrinterModel()}`)

        setPrintStatus("printing")
        logDebug("Print status: printing")

        // Print receipt
        const success = await printReceipt(receiptData)

        if (success) {
          setPrintStatus("success")
          logDebug(`Print status: success (${simpleMode ? "simple mode" : "normal mode"})`)

          // Start 25-second redirect countdown ONLY after successful printing
          startRedirectCountdown()
        } else {
          setPrintStatus("error")
          logDebug("Print status: error (print failed)")
        }

        // Disconnect printer
        await disconnectPrinter()
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

  // Start redirect countdown
  const startRedirectCountdown = () => {
    // Clear all existing timers
    clearAllTimers()

    // Initialize countdown to 25 seconds
    setCountdown(25)
    logDebug("Starting 25-second countdown")

    // Set up countdown timer
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 0) return 0
        return prev - 1
      })
    }, 1000)

    // Set up redirect timer for exactly 25 seconds
    redirectTimerRef.current = setTimeout(() => {
      logDebug("Executing redirect")
      if (onNavigate) {
        onNavigate("standby")
      } else {
        // Fallback for backward compatibility
        window.location.href = "/loading?redirect=/"
      }
    }, 25000)
  }

  // Log countdown changes
  useEffect(() => {
    if (countdown !== null) {
      logDebug(`Countdown: ${countdown} seconds`)
    }
  }, [countdown])

  // Building name display (A동, B동, etc.)
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
    idleTime: 60000, // 60 seconds
    enabled: true,
  })

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

              {/* Building zoom image display - updated to fill available space */}
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

              {/* Printer status display */}
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

              <div className="w-full flex justify-between mt-6">
                <Button
                  className="text-xl font-bold flex items-center space-x-2 h-16 px-6"
                  onClick={() => setShowPrinter(true)}
                >
                  <Printer className="h-6 w-6" />
                  <span>영수증 인쇄</span>
                </Button>

                <Button
                  variant="outline"
                  className="text-xl font-bold h-16 px-6 bg-transparent"
                  onClick={() => {
                    logDebug("Back button clicked: clearing all timers")
                    // Clear all timers
                    clearAllTimers()
                    // 모든 오디오 중지
                    stopAllAudio()
                    // Use onNavigate function instead of redirect
                    if (onNavigate) {
                      onNavigate("standby")
                    } else {
                      // Fallback for backward compatibility
                      window.location.href = "/loading?redirect=/"
                    }
                  }}
                >
                  돌아가기
                </Button>
              </div>

              {/* Only show countdown if printing was successful */}
              {countdown !== null && printStatus === "success" && (
                <div className="w-full bg-gray-100 rounded-lg p-4 mt-4">
                  <p className="text-left text-sm text-gray-500 font-bold">
                    {countdown}초 후 자동으로 대기 화면으로 돌아갑니다.
                  </p>
                </div>
              )}

              {/* 음성 안내 상태 표시 */}
              {audioPlayed && (
                <div className="w-full bg-blue-50 rounded-lg p-4 mt-2">
                  <p className="text-left text-sm text-blue-600 font-bold">
                    {getBuildingType()} 건물 안내 음성이 재생되었습니다.
                  </p>
                </div>
              )}

              {/* Debug information */}
              <div className="w-full mt-2 text-xs text-gray-400 border-t pt-2">
                <p>Print Status: {printStatus}</p>
                <p>Print Mode: {simpleMode ? "Simple" : "Formatted"}</p>
                <p>Printer Model: {printerModel}</p>
                <p>Building Type: {getBuildingType()}</p>
                <p>Audio Played: {audioPlayed ? "Yes" : "No"}</p>
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

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Image from "next/image"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { formatDateKorean } from "@/lib/date-utils"
import { getRoomImagePath, checkImageExists } from "@/lib/room-utils"
import { playAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"

interface Reservation {
  place?: string
  guestName: string
  reservationId: string
  bookingPlatform: string
  roomType: string
  price: string
  phoneNumber?: string
  checkInDate: string
  checkOutDate: string
  roomNumber: string
  password: string
}

interface ReservationDetailsProps {
  reservation: Reservation
  onCheckIn: () => void
  onNavigate: (screen: string) => void
  loading?: boolean
  revealedInfo?: {
    roomNumber?: string
    password?: string
  }
  isPopupMode?: boolean
  kioskLocation: KioskLocation
}

export default function ReservationDetails({
  reservation,
  onCheckIn,
  onNavigate,
  loading = false,
  revealedInfo = {},
  isPopupMode = false,
  kioskLocation,
}: ReservationDetailsProps) {
  const [checkInComplete, setCheckInComplete] = useState(false)
  const [roomImagePath, setRoomImagePath] = useState("/hotel-floor-plan.png")
  const [imageExists, setImageExists] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  const locationTitle = getLocationTitle(kioskLocation)

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] Reservation details idle, navigating to idle screen")
      onNavigate("idle")
    },
    idleTime: 60000, // 60 seconds
    enabled: true,
  })

  useEffect(() => {
    setCheckInComplete(false)

    setRoomImagePath("/hotel-floor-plan.png")
    setImageExists(true)

    playAudio("RESERVATION_FOUND")

    const updateRoomImage = async () => {
      try {
        const roomNumber = revealedInfo?.roomNumber || reservation?.roomNumber || ""

        if (roomNumber && reservation?.roomType) {
          console.log("Room info:", { roomNumber, roomType: reservation.roomType })

          const imagePath = getRoomImagePath(reservation.roomType, roomNumber)
          console.log("Generated image path:", imagePath)

          const exists = await checkImageExists(imagePath)
          console.log("Image exists:", exists)

          if (exists) {
            setRoomImagePath(imagePath)
            setImageExists(true)
          } else {
            console.warn(`Room image not found: ${imagePath}`)
            setRoomImagePath("/hotel-floor-plan.png")
          }
        } else {
          console.log("Missing room number or type:", { roomNumber, roomType: reservation?.roomType })
        }
      } catch (error) {
        console.error("Error loading room image:", error)
        setRoomImagePath("/hotel-floor-plan.png")
      }
    }

    updateRoomImage()
  }, [revealedInfo, reservation?.reservationId])

  if (!reservation) return null

  const handleCheckIn = async () => {
    if (isPopupMode) {
      // Popup mode: Close window directly without showing check-in complete screen
      await onCheckIn()

      if (typeof window !== "undefined" && window.electronAPI) {
        window.electronAPI.send("checkin-complete")
      }
    } else {
      // Normal mode: Show check-in complete screen
      await onCheckIn()
      setCheckInComplete(true)
    }
  }

  const handleBackClick = () => {
    if (isPopupMode) {
      // Close Electron popup window
      if (typeof window !== "undefined" && window.electronAPI) {
        window.electronAPI.send("checkin-complete")
      }
    } else {
      // Normal mode: navigate to standby
      onNavigate("standby")
    }
  }

  const hasRevealedInfo = !!(revealedInfo?.roomNumber || revealedInfo?.password)

  const displayRoomNumber = revealedInfo?.roomNumber || reservation.roomNumber || ""
  const displayPassword = revealedInfo?.password || reservation.password || ""

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">{locationTitle}</h1>
          <div className="kiosk-highlight">예약 확인됨</div>
        </div>

        <div className="w-full overflow-auto py-4 mt-6">
          <Card className="w-full">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {reservation.place && (
                  <div className="col-span-2">
                    <p className="text-sm text-gray-500">장소</p>
                    <p className="font-medium text-lg">{reservation.place}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-gray-500">이름</p>
                  <p className="font-medium">{reservation.guestName}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">예약 플랫폼</p>
                  <p className="font-medium">{reservation.bookingPlatform}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">객실 타입</p>
                  <p className="font-medium">{reservation.roomType}</p>
                </div>

                {reservation.phoneNumber && (
                  <div>
                    <p className="text-sm text-gray-500">전화번호</p>
                    <p className="font-medium">{reservation.phoneNumber}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-gray-500">체크인</p>
                  <p className="font-medium">{formatDateKorean(reservation.checkInDate)}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">체크아웃</p>
                  <p className="font-medium">{formatDateKorean(reservation.checkOutDate)}</p>
                </div>

                {hasRevealedInfo && (
                  <>
                    <div className="col-span-2 mt-2 border-t pt-2">
                      <p className="text-sm font-medium text-gray-700">객실 정보</p>
                    </div>

                    <div>
                      <p className="text-sm text-gray-500">객실 호수</p>
                      <p className="font-medium text-lg text-blue-600">{displayRoomNumber}</p>
                    </div>

                    <div>
                      <p className="text-sm text-gray-500">비밀번호</p>
                      <div className="flex items-center">
                        <p className="font-medium text-lg text-red-600">
                          {showPassword ? displayPassword : displayPassword.replace(/./g, "•")}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2 h-8 w-8 p-0"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          <span className="sr-only">{showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}</span>
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="pt-4">
                <p className="text-sm text-gray-500 mb-2">객실 이미지</p>
                <div className="bg-gray-100 rounded-lg p-2">
                  <div className="relative w-full h-[768px]">
                    <Image
                      src={roomImagePath || "/placeholder.svg"}
                      alt={`${reservation.roomType} 객실 이미지`}
                      fill
                      className="rounded-lg object-cover"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full mt-auto">
          <Button
            size="lg"
            className="h-12 text-lg"
            onClick={handleCheckIn}
            disabled={loading || checkInComplete || hasRevealedInfo}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                처리 중...
              </>
            ) : checkInComplete || hasRevealedInfo ? (
              "체크인 완료"
            ) : (
              "체크인"
            )}
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="h-12 text-lg bg-transparent"
            onClick={handleBackClick}
            disabled={loading}
          >
            돌아가기
          </Button>
        </div>
      </div>
    </div>
  )
}

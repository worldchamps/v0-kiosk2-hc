"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Image from "next/image"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { formatDateTimeKorean, getReservationCheckInEligibility } from "@/lib/date-utils"
import { getRoomImagePath, checkImageExists } from "@/lib/room-utils"
import { playAudio } from "@/lib/audio-utils"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { getKioskPropertyId, propertyUsesElectron } from "@/lib/property-utils"
import SmokingPolicyDialog from "@/components/smoking-policy-dialog"

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
  checkInDateTime?: string
  checkOutDateTime?: string
  roomNumber: string
  password: string
}

interface ReservationDetailsProps {
  reservation: Reservation
  onCheckIn: () => Promise<boolean>
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
  const [showSmokingPolicy, setShowSmokingPolicy] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

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

  const eligibility = getReservationCheckInEligibility(reservation.checkInDateTime ?? reservation.checkInDate, now)

  const completeCheckIn = async () => {
    try {
      if (!eligibility.allowed || !(await onCheckIn())) return

      if (isPopupMode) {
        const property = getKioskPropertyId()
        setTimeout(() => {
          console.log("[v0] Popup mode: Closing window after check-in")
          if (propertyUsesElectron(property)) {
            if (typeof window !== "undefined" && window.electronAPI) {
              window.electronAPI.send("checkin-complete")
            }
          } else {
            window.close()
          }
        }, 30000)
      } else {
        setCheckInComplete(true)
      }
    } catch (error) {
      console.error("[v0] Check-in error:", error)
    }
  }

  const handleCheckIn = () => {
    if (!eligibility.allowed) return
    setShowSmokingPolicy(true)
  }

  const handleSmokingPolicyAgree = async () => {
    setShowSmokingPolicy(false)
    await completeCheckIn()
  }

  const handleBackClick = () => {
    if (isPopupMode) {
      const property = getKioskPropertyId()
      if (propertyUsesElectron(property)) {
        if (typeof window !== "undefined" && window.electronAPI) {
          window.electronAPI.send("checkin-complete")
        }
      } else {
        window.close()
      }
    } else {
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
          <div className="kiosk-highlight">예약 확인됨</div>
        </div>

        <div className={`w-full min-h-0 mt-2 ${isPopupMode ? "py-2" : "py-4"}`}>
          <div className={`flex flex-col ${isPopupMode ? "gap-3" : "gap-6"}`}>
            {/* Image Box */}
            <div className="w-full">
              <Card>
                <CardContent className={isPopupMode ? "p-3" : "p-6"}>
                  <p
                    className={`mb-3 font-bold text-gray-700 ${
                      isPopupMode ? "text-base" : "text-[22px]"
                    }`}
                  >
                    예약한 객실
                  </p>
                  <div className="bg-gray-100 rounded-lg p-2">
                    <div className={`relative w-full ${isPopupMode ? "h-[260px]" : "h-[440px]"}`}>
                      <Image
                        src={roomImagePath || "/placeholder.svg"}
                        alt={`${reservation.roomType} 객실 이미지`}
                        fill
                        className="rounded-lg object-cover"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Info Box */}
            <div className="w-full">
              <Card>
                <CardContent className={isPopupMode ? "p-4" : "p-6"}>
                  <div className={`grid grid-cols-2 ${isPopupMode ? "gap-3" : "gap-5"}`}>
                    <div className={`rounded-xl border bg-gray-50 ${isPopupMode ? "p-3" : "p-5"}`}>
                      <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                        예약자 성함
                      </p>
                      <p
                        className={`mt-2 break-words font-bold leading-tight text-gray-950 ${
                          isPopupMode ? "text-xl" : "text-[30px]"
                        }`}
                      >
                        {reservation.guestName}
                      </p>
                    </div>

                    <div className={`rounded-xl border bg-gray-50 ${isPopupMode ? "p-3" : "p-5"}`}>
                      <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                        예약한 객실 타입
                      </p>
                      <p
                        className={`mt-2 break-words font-bold leading-tight text-gray-950 ${
                          isPopupMode ? "text-xl" : "text-[30px]"
                        }`}
                      >
                        {reservation.roomType}
                      </p>
                    </div>

                    <div className={`rounded-xl border bg-gray-50 ${isPopupMode ? "p-3" : "p-5"}`}>
                      <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                        체크인 날짜
                      </p>
                      <p
                        className={`mt-2 break-words font-bold leading-tight text-gray-950 ${
                          isPopupMode ? "text-xl" : "text-[30px]"
                        }`}
                      >
                        {formatDateTimeKorean(reservation.checkInDateTime || reservation.checkInDate)}
                      </p>
                    </div>

                    <div className={`rounded-xl border bg-gray-50 ${isPopupMode ? "p-3" : "p-5"}`}>
                      <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                        체크아웃 날짜
                      </p>
                      <p
                        className={`mt-2 break-words font-bold leading-tight text-gray-950 ${
                          isPopupMode ? "text-xl" : "text-[30px]"
                        }`}
                      >
                        {formatDateTimeKorean(reservation.checkOutDateTime || reservation.checkOutDate)}
                      </p>
                    </div>

                    {hasRevealedInfo && (
                      <>
                        <div className={`col-span-2 border-t ${isPopupMode ? "pt-3" : "pt-5"}`}>
                          <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                            객실 정보
                          </p>
                        </div>

                        <div className={`rounded-xl border bg-blue-50 ${isPopupMode ? "p-3" : "p-5"}`}>
                          <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                            객실 호수
                          </p>
                          <p className={`mt-2 font-bold text-blue-600 ${isPopupMode ? "text-xl" : "text-[30px]"}`}>
                            {displayRoomNumber}
                          </p>
                        </div>

                        <div className={`rounded-xl border bg-red-50 ${isPopupMode ? "p-3" : "p-5"}`}>
                          <p className={`font-bold text-gray-700 ${isPopupMode ? "text-base" : "text-[22px]"}`}>
                            비밀번호
                          </p>
                          <div className="mt-2 flex items-center">
                            <p className={`font-bold text-red-600 ${isPopupMode ? "text-xl" : "text-[30px]"}`}>
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
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 w-full mt-auto">
          {!eligibility.allowed && !hasRevealedInfo && (
            <p role="status" className="col-span-2 rounded-xl bg-amber-50 p-4 text-2xl font-bold text-amber-900">
              {eligibility.message}
            </p>
          )}
          <Button
            onClick={handleCheckIn}
            disabled={loading || checkInComplete || hasRevealedInfo || !eligibility.allowed}
            className="h-20 text-2xl text-black bg-[#42c0ff] hover:bg-[#3ab0e8] shadow-md font-bold rounded-xl"
          >
            {loading ? (
              <>
                <Loader2 className="mr-3 h-8 w-8 animate-spin" />
                처리 중...
              </>
            ) : checkInComplete || hasRevealedInfo ? (
              "체크인 완료"
            ) : !eligibility.allowed ? (
              eligibility.code === "CHECK_IN_NOT_OPEN" ? "입실 시간 전" : "직원 확인 필요"
            ) : (
              "체크인"
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleBackClick}
            className="h-20 text-2xl border-3 border-gray-300 font-bold rounded-xl bg-transparent"
            disabled={loading}
          >
            돌아가기
          </Button>
        </div>

        <SmokingPolicyDialog
          open={showSmokingPolicy}
          onAgree={handleSmokingPolicyAgree}
          onCancel={() => setShowSmokingPolicy(false)}
          actionLabel="체크인하기"
          cancelLabel="예약 정보로 돌아가기"
        />
      </div>
    </div>
  )
}

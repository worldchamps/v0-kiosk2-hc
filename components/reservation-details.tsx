"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Image from "next/image"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { formatDateKorean } from "@/lib/date-utils"
import { getReservationRoomImage, checkImageExists } from "@/lib/room-utils"
import { playAudio } from "@/lib/audio-utils"

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
}

export default function ReservationDetails({
  reservation,
  onCheckIn,
  onNavigate,
  loading = false,
  revealedInfo = {},
}: ReservationDetailsProps) {
  const [checkInComplete, setCheckInComplete] = useState(false)
  const [roomImagePath, setRoomImagePath] = useState("/placeholder.svg")
  const [imageExists, setImageExists] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  // 객실 이미지 경로 설정
  useEffect(() => {
    setCheckInComplete(false)

    // Reset image state
    setRoomImagePath("/placeholder.svg")
    setImageExists(true)

    // 예약이 확인되었을 때 음성 재생
    playAudio("RESERVATION_FOUND")

    // Update room image when reservation or revealed info changes
    const updateRoomImage = async () => {
      try {
        // 예약 정보에서 객실 번호와 타입 가져오기
        const roomNumber = revealedInfo?.roomNumber || reservation?.roomNumber || ""
        const roomType = reservation?.roomType || ""

        if (roomNumber && roomType) {
          console.log("예약 정보 기반 객실 이미지 설정:", { roomNumber, roomType })

          // 예약 정보 기반 이미지 경로 생성 (객실 코드의 앞 영문자 기준)
          const imagePath = getReservationRoomImage(roomNumber, roomType)
          console.log("생성된 이미지 경로:", imagePath)

          // 이미지 존재 여부 확인
          const exists = await checkImageExists(imagePath)
          console.log("이미지 존재 여부:", exists)

          if (exists) {
            setRoomImagePath(imagePath)
            setImageExists(true)
          } else {
            console.warn(`객실 이미지를 찾을 수 없음: ${imagePath}`)
            setRoomImagePath("/placeholder.svg")
            setImageExists(false)
          }
        } else {
          console.log("객실 번호 또는 타입 정보 부족:", { roomNumber, roomType })
          setRoomImagePath("/placeholder.svg")
          setImageExists(false)
        }
      } catch (error) {
        console.error("객실 이미지 로딩 오류:", error)
        setRoomImagePath("/placeholder.svg")
        setImageExists(false)
      }
    }

    updateRoomImage()
  }, [revealedInfo, reservation?.reservationId, reservation?.roomNumber, reservation?.roomType])

  if (!reservation) return null

  const handleCheckIn = async () => {
    // 체크인 처리 후 객실 번호와 비밀번호 표시
    await onCheckIn()
    setCheckInComplete(true)
  }

  // 객실 번호와 비밀번호가 공개되었는지 확인
  const hasRevealedInfo = !!(revealedInfo?.roomNumber || revealedInfo?.password)

  // 표시할 객실 번호와 비밀번호 (체크인 완료 후 공개된 정보 또는 예약 정보)
  const displayRoomNumber = revealedInfo?.roomNumber || reservation.roomNumber || ""
  const displayPassword = revealedInfo?.password || reservation.password || ""

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">더 비치스테이</h1>
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

                {/* 객실 번호와 비밀번호 표시 영역 - 체크인 완료 후에만 표시 */}
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
                  <div className="relative w-full h-[400px]">
                    <Image
                      src={roomImagePath || "/placeholder.svg"}
                      alt={`${reservation.roomType} 객실 이미지`}
                      fill
                      className="rounded-lg object-cover"
                      onError={(e) => {
                        console.log(`이미지 로드 실패: ${e.currentTarget.src}`)
                        e.currentTarget.src = "/placeholder.svg"
                        setImageExists(false)
                      }}
                    />
                    {!imageExists && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-200 rounded-lg">
                        <p className="text-gray-500">이미지를 불러올 수 없습니다</p>
                      </div>
                    )}
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
            onClick={() => onNavigate("standby")}
            disabled={loading}
          >
            돌아가기
          </Button>
        </div>
      </div>
    </div>
  )
}

"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playAudio } from "@/lib/audio-utils"
import { useEffect } from "react"

interface Reservation {
  place: string
  guestName: string
  reservationId: string
  bookingPlatform: string
  roomType: string
  price: string
  phoneNumber: string
  checkInDate: string
  checkOutDate: string
  roomNumber: string
  password: string
  checkInStatus: string
  checkInTime: string
  floor: string
}

interface ReservationListProps {
  reservations: Reservation[]
  onSelectReservation: (reservation: Reservation) => void
  onNavigate: (screen: string) => void
  kioskLocation: KioskLocation
  guestName: string
}

export default function ReservationList({
  reservations,
  onSelectReservation,
  onNavigate,
  kioskLocation,
  guestName,
}: ReservationListProps) {
  const locationTitle = getLocationTitle(kioskLocation)

  useEffect(() => {
    playAudio("MULTIPLE_RESERVATIONS")
  }, [])

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">{locationTitle}</h1>
          <div className="kiosk-highlight">예약 선택</div>
        </div>

        <div className="w-full space-y-6 mt-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold">
              {guestName}님의 예약이 {reservations.length}건 있습니다
            </h2>
            <p className="text-2xl text-gray-600">확인하실 예약을 선택해주세요</p>
          </div>

          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {reservations.map((reservation, index) => (
              <Card
                key={reservation.reservationId}
                className="p-6 hover:bg-gray-50 cursor-pointer transition-colors border-2"
                onClick={() => onSelectReservation(reservation)}
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xl font-semibold text-gray-700">예약 번호</div>
                    <div className="text-2xl font-bold">{reservation.reservationId}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xl font-semibold text-gray-700">객실 타입</div>
                    <div className="text-2xl font-bold">{reservation.roomType}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xl font-semibold text-gray-700">체크인</div>
                    <div className="text-2xl">{reservation.checkInDate}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xl font-semibold text-gray-700">체크아웃</div>
                    <div className="text-2xl">{reservation.checkOutDate}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xl font-semibold text-gray-700">예약 플랫폼</div>
                    <div className="text-2xl">{reservation.bookingPlatform}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xl font-semibold text-gray-700">상태</div>
                    <div className="text-2xl">{reservation.checkInStatus || "체크인 전"}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="pt-6">
            <Button
              variant="outline"
              onClick={() => onNavigate("reservationConfirm")}
              className="w-full h-20 text-2xl border-3 border-gray-300 font-bold rounded-xl"
            >
              돌아가기
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

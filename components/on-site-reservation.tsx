"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Phone, Loader2, Home, Moon, Clock, AlertTriangle, CalendarDays, RefreshCw } from "lucide-react"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { getRoomImagePath } from "@/lib/room-utils"
import { sortRoomTypes } from "@/lib/room-type-order"
import { usePayment } from "@/contexts/payment-context"
import PaymentScreen from "@/components/payment-screen"
import CheckInComplete from "@/components/check-in-complete"

interface OnSiteReservationProps {
  onNavigate: (screen: string) => void
  location?: string
}

interface AvailableRoom {
  building: string
  roomNumber: string
  roomType: string
  status: string
  password: string
  floor: string
  roomCode: string
}

type BookingStep = "roomType" | "roomSelect" | "guestInfo" | "complete" | "payment"

const ROOM_TYPE_PRICES = [
  { keyword: "디럭스", overnight: 60000, shortStay: 30000 },
  { keyword: "스위트", overnight: 80000, shortStay: 50000 },
  { keyword: "스탠다드", overnight: 50000, shortStay: 30000 },
]

function getRoomTypePrices(roomType: string) {
  return ROOM_TYPE_PRICES.find(({ keyword }) => roomType.includes(keyword))
}

function formatPrice(price: number) {
  return `${price.toLocaleString("ko-KR")}원`
}

export default function OnSiteReservation({ onNavigate, location }: OnSiteReservationProps) {
  const [step, setStep] = useState<BookingStep>("roomType")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [roomsByType, setRoomsByType] = useState<Record<string, AvailableRoom[]>>({})
  const [selectedRoomType, setSelectedRoomType] = useState<string>("")
  const [selectedRoom, setSelectedRoom] = useState<AvailableRoom | null>(null)
  const [guestName, setGuestName] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [checkInDate, setCheckInDate] = useState("")
  const [checkOutDate, setCheckOutDate] = useState("")
  const [reservationData, setReservationData] = useState<any>(null)
  const [roomsError, setRoomsError] = useState("")
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const { paymentSession, startPayment, completePayment, cancelPayment } = usePayment()
  const bookingPrice = 100000

  const locationName = location === "CAMP" ? "캠프" : location ? `${location}동` : ""

  const fetchAvailableRooms = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) {
          setLoading(true)
        }
        setRoomsError("")

        const url = location ? `/api/available-rooms?location=${location}` : "/api/available-rooms"
        const response = await fetch(`${url}&t=${Date.now()}`, {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error(`Room lookup failed (${response.status})`)
        }

        const data = await response.json()
        setRoomsByType(data.roomsByType || {})
        setLastUpdated(new Date())
      } catch (error) {
        console.error("Error fetching available rooms:", error)
        setRoomsError("객실 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.")
      } finally {
        if (showLoading) {
          setLoading(false)
        }
      }
    },
    [location],
  )

  const resetToHome = useCallback(async () => {
    if (paymentSession.isActive && paymentSession.acceptedAmount > 0) {
      console.warn("[v0] Cash has been inserted. Keeping the payment screen active.")
      return
    }

    if (paymentSession.isActive) {
      await cancelPayment()
    }

    setSelectedRoomType("")
    setSelectedRoom(null)
    setGuestName("")
    setPhoneNumber("")
    setReservationData(null)
    setStep("roomType")
    await fetchAvailableRooms(false)
  }, [cancelPayment, fetchAvailableRooms, paymentSession.acceptedAmount, paymentSession.isActive])

  useIdleTimer({
    onIdle: async () => {
      console.log("[v0] On-site reservation idle, returning to the room home screen")
      await resetToHome()
    },
    idleTime: 60000,
    enabled: true,
  })

  useEffect(() => {
    fetchAvailableRooms()
    // Set default dates (today and tomorrow)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    setCheckInDate(today.toISOString().split("T")[0])
    setCheckOutDate(tomorrow.toISOString().split("T")[0])
  }, [fetchAvailableRooms])

  useEffect(() => {
    if (step !== "roomType") return

    const refreshInterval = window.setInterval(() => {
      fetchAvailableRooms(false)
    }, 60000)

    return () => window.clearInterval(refreshInterval)
  }, [fetchAvailableRooms, step])

  const handleRoomTypeSelect = (roomType: string) => {
    setSelectedRoomType(roomType)
    setStep("roomSelect")
  }

  const handleRoomSelect = (room: AvailableRoom) => {
    setSelectedRoom(room)

    // Skip guest info step, set dummy data
    const dummyGuest = "On-Site Guest"
    const dummyPhone = "000-0000-0000"
    setGuestName(dummyGuest)
    setPhoneNumber(dummyPhone)

    const reservationInfo = {
      guestName: dummyGuest,
      phoneNumber: dummyPhone,
      roomNumber: room.roomCode,
      roomCode: room.roomCode,
      roomType: room.roomType,
      building: room.building,
      checkInDate,
      checkOutDate,
      password: room.password,
    }

    startPayment(bookingPrice, reservationInfo)
    setStep("payment")
  }

  const handleSubmitBooking = async () => {
    if (!selectedRoom || !guestName || !phoneNumber) {
      alert("모든 정보를 입력해주세요")
      return
    }

    const reservationInfo = {
      guestName,
      phoneNumber,
      roomNumber: selectedRoom.roomCode,
      roomCode: selectedRoom.roomCode,
      roomType: selectedRoom.roomType,
      building: selectedRoom.building,
      checkInDate,
      checkOutDate,
      password: selectedRoom.password,
    }

    startPayment(bookingPrice, reservationInfo)
    setStep("payment")
  }

  const handlePaymentComplete = async () => {
    try {
      setSubmitting(true)
      const response = await fetch("/api/on-site-booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guestName,
          phoneNumber,
          roomNumber: selectedRoom?.roomCode,
          roomCode: selectedRoom?.roomCode,
          roomType: selectedRoom?.roomType,
          building: selectedRoom?.building,
          price: bookingPrice,
          checkInDate,
          checkOutDate,
          password: selectedRoom?.password,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setReservationData(data.data)
        completePayment()
        await fetchAvailableRooms()
        setStep("complete")
      } else {
        alert("예약 중 오류가 발생했습니다: " + data.error)
        await cancelPayment()
        setStep("roomSelect")
      }
    } catch (error) {
      console.error("Error submitting booking:", error)
      alert("예약 중 오류가 발생했습니다: " + (error instanceof Error ? error.message : String(error)))
      await cancelPayment()
      setStep("roomSelect")
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaymentCancel = async () => {
    await cancelPayment()
    setStep("roomSelect")
  }

  // Step 1: Room Type Selection
  if (step === "roomType") {
    const availableRoomTypes = sortRoomTypes(Object.keys(roomsByType))

    return (
      <div className="kiosk-home-screen">
        <div className="kiosk-home-header">
          <div className="kiosk-home-heading">
            <p className="kiosk-home-property">더 비치스테이 {locationName}</p>
            <h1 className="kiosk-home-title">지금 바로 이용 가능한 객실</h1>
            <p className="kiosk-home-subtitle">원하시는 객실 타입을 선택해주세요</p>
          </div>

          <Button
            type="button"
            onClick={() => onNavigate("reservationConfirm")}
            className="kiosk-reservation-check-button"
          >
            <CalendarDays className="h-10 w-10" />
            <span>
              <strong>예약 확인하기</strong>
              <small>이미 예약하신 고객</small>
            </span>
          </Button>
        </div>

        <div className="kiosk-cash-banner">
          <AlertTriangle className="h-9 w-9 flex-shrink-0" />
          <div>
            <p>현금(지폐) 결제만 가능합니다</p>
            <span>Cash Only · 카드 결제 불가</span>
          </div>
          <button
            type="button"
            className="kiosk-room-refresh-button"
            onClick={() => fetchAvailableRooms(false)}
            aria-label="객실 정보 새로고침"
          >
            <RefreshCw className={`h-6 w-6 ${loading ? "animate-spin" : ""}`} />
            <span>
              {lastUpdated
                ? `${lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신`
                : "새로고침"}
            </span>
          </button>
        </div>

        <div className="kiosk-home-content">
          {roomsError && (
            <div className="kiosk-home-message kiosk-home-message-error">
              <AlertTriangle className="h-12 w-12" />
              <p>{roomsError}</p>
              <Button type="button" onClick={() => fetchAvailableRooms()}>
                다시 불러오기
              </Button>
            </div>
          )}

          {!roomsError && loading && availableRoomTypes.length === 0 && (
            <div className="kiosk-home-grid" aria-label="객실 정보를 불러오는 중">
              {[0, 1, 2].map((index) => (
                <div key={index} className="kiosk-room-card kiosk-room-card-loading">
                  <div className="kiosk-room-image-skeleton" />
                  <div className="kiosk-room-card-body">
                    <div className="w-full">
                      <div className="kiosk-room-text-skeleton kiosk-room-text-skeleton-title" />
                      <div className="kiosk-room-text-skeleton" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!roomsError && !loading && availableRoomTypes.length === 0 && (
            <div className="kiosk-home-message">
              <Phone className="h-16 w-16 text-gray-400" />
              <div>
                <p className="text-3xl font-bold">현재 예약 가능한 객실이 없습니다</p>
                <span className="text-xl text-gray-600">예약 문의 010-5126-4644</span>
              </div>
            </div>
          )}

          {!roomsError && availableRoomTypes.length > 0 && (
            <div className="kiosk-home-grid">
              {availableRoomTypes.map((roomType) => {
                const rooms = roomsByType[roomType]
                const availableCount = rooms.length
                const sampleRoom = rooms[0]
                const imagePath = getRoomImagePath(roomType, sampleRoom.roomCode)
                const prices = getRoomTypePrices(roomType)

                return (
                  <button
                    type="button"
                    key={roomType}
                    className="kiosk-room-card"
                    onClick={() => handleRoomTypeSelect(roomType)}
                  >
                    <div className="kiosk-room-card-image">
                      <img
                        src={imagePath || "/placeholder.svg"}
                        alt={roomType}
                        onError={(e) => {
                          e.currentTarget.src = "/placeholder.svg?height=360&width=560"
                        }}
                      />
                      <span className="kiosk-room-availability">{availableCount}개 예약 가능</span>
                    </div>
                    <div className="kiosk-room-card-body">
                      <div className="kiosk-room-card-copy">
                        <h2>{roomType}</h2>
                        <p>카드를 눌러 이용 가능한 객실을 확인하세요</p>
                      </div>
                      {prices ? (
                        <div className="kiosk-room-prices" aria-label={`${roomType} 이용 요금`}>
                          <div className="kiosk-room-price kiosk-room-price-overnight">
                            <span>
                              <Moon className="kiosk-room-price-icon" />
                              숙박
                            </span>
                            <strong>{formatPrice(prices.overnight)}</strong>
                          </div>
                          <div className="kiosk-room-price kiosk-room-price-short-stay">
                            <span>
                              <Clock className="kiosk-room-price-icon" />
                              대실
                            </span>
                            <strong>{formatPrice(prices.shortStay)}</strong>
                          </div>
                        </div>
                      ) : (
                        <div className="kiosk-room-price-fallback">객실을 눌러 요금을 확인하세요</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Step 2: Room Selection
  if (step === "roomSelect" && selectedRoomType) {
    const rooms = roomsByType[selectedRoomType] || []

    return (
      <div className="flex items-start justify-start w-full h-full">
        <div className="kiosk-content-container">
          <div>
            <h1 className="kiosk-title">더 비치스테이 {locationName}</h1>
            <div className="kiosk-highlight">{selectedRoomType} - 객실 선택 (2/3)</div>
          </div>

          <div className="flex-1 w-full py-6 mt-8 flex flex-col">
            <div className="grid grid-cols-2 gap-6 w-full">
              {rooms.map((room) => {
                const imagePath = getRoomImagePath(room.roomType, room.roomCode)

                return (
                  <Card
                    key={room.roomCode}
                    className="overflow-hidden shadow-lg cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02]"
                    onClick={() => handleRoomSelect(room)}
                  >
                    <CardContent className="p-0">
                      <div className="w-full h-48 bg-gray-100">
                        <img
                          src={imagePath || "/placeholder.svg"}
                          alt={room.roomCode}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = "/placeholder.svg?height=200&width=300"
                          }}
                        />
                      </div>
                      <div className="p-6">
                        <p className="font-bold text-3xl mb-2">{room.roomCode}</p>
                        <p className="text-xl text-gray-600 flex items-center gap-2">
                          <Home className="h-5 w-5" />
                          {room.building} · {room.floor}층
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => setStep("roomType")}
            className="h-20 text-2xl w-full border-3 border-gray-300 mt-6 font-bold"
          >
            돌아가기
          </Button>
        </div>
      </div>
    )
  }

  // Step 3: Guest Information
  if (step === "guestInfo" && selectedRoom) {
    const imagePath = getRoomImagePath(selectedRoom.roomType, selectedRoom.roomCode)

    return (
      <div className="flex items-start justify-start w-full h-full">
        <div className="kiosk-content-container">
          <div>
            <h1 className="kiosk-title">더 비치스테이 {locationName}</h1>
            <div className="kiosk-highlight">예약 정보 입력 (3/3)</div>
          </div>

          <div className="w-full space-y-6 mt-8">
            <Card className="shadow-md">
              <CardContent className="p-0">
                <div className="flex">
                  <div className="w-48 h-48 bg-gray-100 flex-shrink-0">
                    <img
                      src={imagePath || "/placeholder.svg"}
                      alt={selectedRoom.roomType}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "/placeholder.svg?height=200&width=200"
                      }}
                    />
                  </div>
                  <div className="flex-1 p-6">
                    <h3 className="text-2xl font-bold mb-4">선택한 객실</h3>
                    <div className="space-y-2">
                      <p className="text-xl">
                        <span className="font-semibold">객실 번호:</span> {selectedRoom.roomCode}
                      </p>
                      <p className="text-xl">
                        <span className="font-semibold">객실 타입:</span> {selectedRoom.roomType}
                      </p>
                      <p className="text-xl">
                        <span className="font-semibold">건물:</span> {selectedRoom.building}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div>
                <Label htmlFor="guestName" className="text-xl font-semibold">
                  투숙객 성함
                </Label>
                <Input
                  id="guestName"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="성함을 입력하세요"
                  className="h-16 text-2xl mt-2"
                />
              </div>

              <div>
                <Label htmlFor="phoneNumber" className="text-xl font-semibold">
                  연락처
                </Label>
                <Input
                  id="phoneNumber"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="010-0000-0000"
                  className="h-16 text-2xl mt-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="checkInDate" className="text-xl font-semibold">
                    체크인 날짜
                  </Label>
                  <Input
                    id="checkInDate"
                    type="date"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="h-16 text-2xl mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="checkOutDate" className="text-xl font-semibold">
                    체크아웃 날짜
                  </Label>
                  <Input
                    id="checkOutDate"
                    type="date"
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    className="h-16 text-2xl mt-2"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                variant="outline"
                onClick={() => setStep("roomSelect")}
                className="h-20 text-2xl flex-1 border-3 border-gray-300 font-bold"
              >
                이전
              </Button>
              <Button
                onClick={handleSubmitBooking}
                disabled={submitting || !guestName || !phoneNumber}
                className="h-20 text-2xl flex-1 font-bold"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                    예약 중...
                  </>
                ) : (
                  "예약 완료"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Step 4: Payment
  if (step === "payment" && selectedRoom) {
    return (
      <PaymentScreen
        requiredAmount={bookingPrice}
        onPaymentComplete={handlePaymentComplete}
        onCancel={handlePaymentCancel}
        title={`더 비치스테이 ${locationName}`}
        description="현장 예약 - 결제 (현금 전용 / Cash Only)"
      />
    )
  }

  // Step 5: Completion
  if (step === "complete" && reservationData) {
    return (
      <CheckInComplete
        reservation={reservationData}
        revealedInfo={{
          roomNumber: reservationData.roomCode || selectedRoom?.roomCode || "",
          password: reservationData.password || selectedRoom?.password || "",
          floor: selectedRoom?.floor || "",
        }}
        kioskLocation={location as any}
        onNavigate={onNavigate}
        isPopupMode={false}
      />
    )
  }

  return null
}

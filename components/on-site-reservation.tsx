"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Phone, Loader2, CheckCircle2, Printer, Home, Bed } from "lucide-react"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { getRoomImagePath } from "@/lib/room-utils"
import { sortRoomTypes } from "@/lib/room-type-order"
import { printOnSiteReservationReceipt } from "@/lib/printer-utils"
import { usePayment } from "@/contexts/payment-context"
import PaymentScreen from "@/components/payment-screen"

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
  const [isPrinting, setIsPrinting] = useState(false)
  const { startPayment, completePayment, cancelPayment } = usePayment()
  const bookingPrice = 50000

  const locationName = location === "CAMP" ? "캠프" : location ? `${location}동` : ""

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] On-site reservation idle, navigating to idle screen")
      onNavigate("idle")
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
  }, [location])

  const fetchAvailableRooms = async () => {
    try {
      setLoading(true)
      const url = location ? `/api/available-rooms?location=${location}` : "/api/available-rooms"
      const response = await fetch(`${url}&t=${Date.now()}`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (data.roomsByType) {
        setRoomsByType(data.roomsByType)
      }
    } catch (error) {
      console.error("Error fetching available rooms:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRoomTypeSelect = (roomType: string) => {
    setSelectedRoomType(roomType)
    setStep("roomSelect")
  }

  const handleRoomSelect = (room: AvailableRoom) => {
    setSelectedRoom(room)
    setStep("guestInfo")
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
        setStep("guestInfo")
      }
    } catch (error) {
      console.error("Error submitting booking:", error)
      alert("예약 중 오류가 발생했습니다: " + (error instanceof Error ? error.message : String(error)))
      await cancelPayment()
      setStep("guestInfo")
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaymentCancel = async () => {
    await cancelPayment()
    setStep("guestInfo")
  }

  const handlePrintReceipt = async () => {
    if (!reservationData) return

    setIsPrinting(true)
    try {
      const success = await printOnSiteReservationReceipt({
        reservationId: reservationData.reservationId,
        guestName,
        roomCode: reservationData.roomCode,
        roomType: selectedRoom?.roomType || "",
        checkInDate,
        checkOutDate,
        password: reservationData.password,
      })

      if (success) {
        alert("영수증이 출력되었습니다")
      } else {
        alert("영수증 출력에 실패했습니다")
      }
    } catch (error) {
      console.error("Print error:", error)
      alert("영수증 출력 중 오류가 발생했습니다")
    } finally {
      setIsPrinting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <Loader2 className="h-16 w-16 animate-spin text-gray-400" />
      </div>
    )
  }

  // Step 1: Room Type Selection
  if (step === "roomType") {
    const availableRoomTypes = sortRoomTypes(Object.keys(roomsByType))

    if (availableRoomTypes.length === 0) {
      return (
        <div className="flex items-start justify-start w-full h-full">
          <div className="kiosk-content-container">
            <div>
              <h1 className="kiosk-title">더 비치스테이 {locationName}</h1>
              <div className="kiosk-highlight">현장 예약</div>
            </div>

            <Card className="w-full mt-8 shadow-md">
              <CardContent className="p-8 flex flex-col items-center justify-center space-y-6">
                <Phone className="h-16 w-16 text-gray-400" />
                <div className="text-center">
                  <p className="font-bold text-2xl mb-2">현재 예약 가능한 객실이 없습니다</p>
                  <p className="text-xl text-gray-600 mb-4">예약 문의는 아래 번호로 연락 부탁드립니다</p>
                  <p className="text-3xl font-bold">010-5126-4644</p>
                </div>
              </CardContent>
            </Card>

            <Button
              variant="outline"
              onClick={() => onNavigate("standby")}
              className="h-20 text-2xl w-full border-3 border-gray-300 mt-8 font-bold"
            >
              돌아가기
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-start justify-start w-full h-full">
        <div className="kiosk-content-container">
          <div>
            <h1 className="kiosk-title">더 비치스테이 {locationName}</h1>
            <div className="kiosk-highlight">현장 예약 - 객실 타입 선택 (1/3)</div>
          </div>

          <div className="flex-1 w-full py-6 mt-8 flex flex-col">
            <div className="grid grid-cols-1 gap-6 w-full">
              {availableRoomTypes.map((roomType) => {
                const rooms = roomsByType[roomType]
                const availableCount = rooms.length
                const sampleRoom = rooms[0]
                const imagePath = getRoomImagePath(roomType, sampleRoom.roomCode)

                return (
                  <Card
                    key={roomType}
                    className="overflow-hidden shadow-lg cursor-pointer hover:shadow-xl transition-all hover:scale-[1.02]"
                    onClick={() => handleRoomTypeSelect(roomType)}
                  >
                    <CardContent className="p-0">
                      <div className="flex">
                        <div className="w-48 h-48 bg-gray-100 flex-shrink-0">
                          <img
                            src={imagePath || "/placeholder.svg"}
                            alt={roomType}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src = "/placeholder.svg?height=200&width=200"
                            }}
                          />
                        </div>
                        <div className="flex-1 p-6 flex flex-col justify-between">
                          <div>
                            <p className="font-bold text-3xl mb-2">{roomType}</p>
                            <p className="text-xl text-gray-600 flex items-center gap-2">
                              <Bed className="h-5 w-5" />
                              예약 가능: {availableCount}개
                            </p>
                          </div>
                          <div className="text-right mt-4">
                            <Button size="lg" className="text-xl px-8">
                              선택하기
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => onNavigate("standby")}
            className="h-20 text-2xl w-full border-3 border-gray-300 mt-6 font-bold"
          >
            돌아가기
          </Button>
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
        description="현장 예약 - 결제"
      />
    )
  }

  // Step 5: Completion
  if (step === "complete" && reservationData) {
    return (
      <div className="flex items-start justify-start w-full h-full">
        <div className="kiosk-content-container">
          <div>
            <h1 className="kiosk-title">더 비치스테이 {locationName}</h1>
            <div className="kiosk-highlight">예약 완료</div>
          </div>

          <div className="w-full space-y-6 mt-8">
            <div className="flex justify-center">
              <CheckCircle2 className="h-32 w-32 text-green-500" />
            </div>

            <Card className="shadow-md">
              <CardContent className="p-8 space-y-4">
                <h3 className="text-3xl font-bold text-center mb-6">예약이 완료되었습니다!</h3>

                <div className="space-y-3">
                  <p className="text-xl">
                    <span className="font-semibold">예약 번호:</span> {reservationData.reservationId}
                  </p>
                  <p className="text-xl">
                    <span className="font-semibold">투숙객:</span> {guestName}
                  </p>
                  <p className="text-xl">
                    <span className="font-semibold">객실 번호:</span> {reservationData.roomCode}
                  </p>
                  <p className="text-xl">
                    <span className="font-semibold">객실 비밀번호:</span> {reservationData.password}
                  </p>
                  <p className="text-xl">
                    <span className="font-semibold">체크인:</span> {checkInDate}
                  </p>
                  <p className="text-xl">
                    <span className="font-semibold">체크아웃:</span> {checkOutDate}
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <p className="text-lg text-gray-600 text-center">문의사항은 010-5126-4644로 연락 부탁드립니다.</p>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <Button
                onClick={handlePrintReceipt}
                disabled={isPrinting}
                variant="outline"
                className="h-20 text-2xl flex-1 font-bold bg-transparent"
              >
                {isPrinting ? (
                  <>
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                    출력 중...
                  </>
                ) : (
                  <>
                    <Printer className="mr-2 h-6 w-6" />
                    영수증 출력
                  </>
                )}
              </Button>
              <Button onClick={() => onNavigate("standby")} className="h-20 text-2xl flex-1 font-bold">
                처음으로
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

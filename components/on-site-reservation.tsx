"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Phone,
  Loader2,
  Home,
  Moon,
  Clock,
  AlertTriangle,
  CalendarDays,
  CreditCard,
  Landmark,
  ArrowLeft,
  DoorOpen,
  Check,
  CigaretteOff,
} from "lucide-react"
import { useIdleTimer } from "@/hooks/use-idle-timer"
import { getRoomImagePath } from "@/lib/room-utils"
import { sortRoomTypes } from "@/lib/room-type-order"
import { usePayment } from "@/contexts/payment-context"
import PaymentScreen from "@/components/payment-screen"
import type { CompletedPayment } from "@/lib/payment-types"
import CheckInComplete from "@/components/check-in-complete"
import { KioskProgressScreen, ON_SITE_PROGRESS_STEPS } from "@/components/kiosk-progress"
import type { PmsPaymentRates, PmsRoomRates } from "@/lib/pms-rates"

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
  rates: PmsRoomRates | null
  stayEnabled: Record<StayType, boolean>
  ratesSource: "kiosk_sales_config" | "pms_status" | null
  ratesUpdatedAt: string | null
}

type BookingStep = "stayType" | "roomType" | "roomSelect" | "confirm" | "guestInfo" | "complete" | "payment"
type StayType = "overnight" | "shortStay"

interface StaySelection {
  type: StayType
  label: "숙박" | "대실"
}

function getRoomTypePrices(rooms: AvailableRoom[], stayType: StayType) {
  return rooms.find((room) => hasAvailableStay(room, stayType))?.rates
}

function hasAvailableRate(rates: PmsPaymentRates | undefined) {
  return Boolean(rates && (rates.card > 0 || rates.cash > 0))
}

function hasAvailableStay(room: AvailableRoom, stayType: StayType) {
  return room.stayEnabled?.[stayType] === true && hasAvailableRate(room.rates?.[stayType])
}

function formatPaymentRates(rates: PmsPaymentRates) {
  const parts = []
  if (rates.card > 0) parts.push(`카드 ${formatPrice(rates.card)}`)
  if (rates.cash > 0) parts.push(`현금 ${formatPrice(rates.cash)}`)
  return parts.join(" · ")
}

function formatPrice(price: number) {
  return `${price.toLocaleString("ko-KR")}원`
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getBookingDates(stayType: StayType) {
  const today = new Date()
  const checkOut = new Date(today)

  if (stayType === "overnight") {
    checkOut.setDate(checkOut.getDate() + 1)
  }

  return {
    checkInDate: formatLocalDate(today),
    checkOutDate: formatLocalDate(checkOut),
  }
}

export default function OnSiteReservation({ onNavigate, location }: OnSiteReservationProps) {
  const [step, setStep] = useState<BookingStep>("stayType")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [roomsByType, setRoomsByType] = useState<Record<string, AvailableRoom[]>>({})
  const [selectedRoomType, setSelectedRoomType] = useState<string>("")
  const [selectedStay, setSelectedStay] = useState<StaySelection | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<AvailableRoom | null>(null)
  const [guestName, setGuestName] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [checkInDate, setCheckInDate] = useState("")
  const [checkOutDate, setCheckOutDate] = useState("")
  const [reservationData, setReservationData] = useState<any>(null)
  const [roomsError, setRoomsError] = useState("")
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const { paymentSession, startPayment, completePayment, cancelPayment } = usePayment()
  const selectedRates = selectedRoom && selectedStay ? selectedRoom.rates?.[selectedStay.type] : undefined

  const locationName = location === "CAMP" ? "캠프" : location ? `${location}동` : ""

  const fetchAvailableRooms = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) {
          setLoading(true)
        }
        setRoomsError("")

        const params = new URLSearchParams({ t: String(Date.now()) })
        if (location) {
          params.set("location", location)
        }
        const response = await fetch(`/api/available-rooms?${params.toString()}`, {
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
    setSelectedStay(null)
    setSelectedRoom(null)
    setGuestName("")
    setPhoneNumber("")
    setReservationData(null)
    setStep("stayType")
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
    const dates = getBookingDates("overnight")
    setCheckInDate(dates.checkInDate)
    setCheckOutDate(dates.checkOutDate)
  }, [fetchAvailableRooms])

  useEffect(() => {
    if (step !== "stayType" && step !== "roomType") return

    const refreshInterval = window.setInterval(() => {
      fetchAvailableRooms(false)
    }, 60000)

    return () => window.clearInterval(refreshInterval)
  }, [fetchAvailableRooms, step])

  const handleStayTypeSelect = (stay: StaySelection) => {
    const available = Object.values(roomsByType).some((rooms) => rooms.some((room) => hasAvailableStay(room, stay.type)))
    if (!available) {
      alert(`현재 ${stay.label}으로 판매 가능한 객실이 없습니다.`)
      return
    }
    const dates = getBookingDates(stay.type)
    setSelectedStay(stay)
    setCheckInDate(dates.checkInDate)
    setCheckOutDate(dates.checkOutDate)
    setStep("roomType")
  }

  const handleRoomTypeSelect = (roomType: string) => {
    setSelectedRoomType(roomType)
    setStep("roomSelect")
  }

  const startRoomPayment = (room: AvailableRoom) => {
    if (!selectedStay) return

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
      stayType: selectedStay.type,
      stayTypeLabel: selectedStay.label,
      rates: room.rates?.[selectedStay.type] ?? null,
    }

    const roomRates = room.rates?.[selectedStay.type]
    if (!hasAvailableStay(room, selectedStay.type)) {
      alert("이 객실의 이용금액을 확인할 수 없습니다. 다른 객실을 선택해주세요.")
      return
    }

    startPayment(roomRates?.cash || roomRates?.card || 0, reservationInfo)
    setStep("payment")
  }

  const handleRoomSelect = (room: AvailableRoom) => {
    if (!selectedStay) return

    setSelectedRoom(room)
    setStep("confirm")
  }

  const handleSubmitBooking = async () => {
    if (!selectedRoom || !selectedStay || !guestName || !phoneNumber) {
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
      stayType: selectedStay.type,
      stayTypeLabel: selectedStay.label,
      rates: selectedRoom.rates?.[selectedStay.type] ?? null,
    }

    const roomRates = selectedRoom.rates?.[selectedStay.type]
    if (!hasAvailableStay(selectedRoom, selectedStay.type)) {
      alert("이 객실의 이용금액을 확인할 수 없습니다. 다른 객실을 선택해주세요.")
      return
    }

    startPayment(roomRates?.cash || roomRates?.card || 0, reservationInfo)
    setStep("payment")
  }

  const handlePaymentComplete = async (payment: CompletedPayment) => {
    const bookingPrice =
      payment.method === "CARD" ? selectedRates?.card ?? 0 : selectedRates?.cash ?? 0

    const cancelApprovedFrontPayment = async () => {
      if (payment.provider !== "TOSS_FRONT" || !payment.front) return
      try {
        const result = await window.electronAPI?.tossFront?.cancelPayment(payment.front)
        if (!result?.success) {
          console.error("[Toss Front] Automatic approval cancellation failed:", result?.error)
          alert("카드 승인취소에 실패했습니다. 관리자에게 문의해주세요.")
        }
      } catch (frontCancelError) {
        console.error("[Toss Front] Automatic approval cancellation failed:", frontCancelError)
        alert("카드 승인취소에 실패했습니다. 관리자에게 문의해주세요.")
      }
    }

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
          stayType: selectedStay?.type,
          stayTypeLabel: selectedStay?.label,
          payment,
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
        await cancelApprovedFrontPayment()
        await cancelPayment()
        setStep("roomSelect")
      }
    } catch (error) {
      console.error("Error submitting booking:", error)
      alert("예약 중 오류가 발생했습니다: " + (error instanceof Error ? error.message : String(error)))
      await cancelApprovedFrontPayment()
      await cancelPayment()
      setStep("roomSelect")
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaymentCancel = async () => {
    await cancelPayment()
    setStep("confirm")
  }

  // Step 1: Stay type selection
  if (step === "stayType") {
    const availableRoomTypes = sortRoomTypes(Object.keys(roomsByType))
    const allRooms = Object.values(roomsByType).flat()
    const showOvernight = allRooms.some((room) => hasAvailableStay(room, "overnight"))
    const showShortStay = allRooms.some((room) => hasAvailableStay(room, "shortStay"))

    return (
      <div className="kiosk-home-screen">
        <header className="kiosk-home-hero">
          <div className="kiosk-home-heading">
            <p>더 비치스테이 · {locationName}</p>
            <h1>어떻게<br />이용하시나요?</h1>
            <span>원하시는 이용 방법을 먼저 선택해주세요.</span>
          </div>

          <div className="kiosk-home-payment-badge">
            <CreditCard aria-hidden="true" />
            <span>
              <small>결제 방법</small>
              <strong>카드 · 현금</strong>
            </span>
          </div>
        </header>

        <section className="kiosk-payment-notice" aria-label="결제 및 문의 안내">
          <div className="kiosk-payment-help-title">도움이 필요하세요?</div>
          <p>
            <Landmark aria-hidden="true" />
            <span>계좌번호</span>
            <strong>농협 352-1453-5719-23</strong>
            <small>김동훈</small>
          </p>
          <p>
            <Phone aria-hidden="true" />
            <span>기계 고장 및 문의</span>
            <strong>010-5126-4644</strong>
          </p>
        </section>

        <div className="kiosk-stay-type-content">
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
            <div className="kiosk-stay-loading" aria-label="객실 정보를 불러오는 중">
              객실 정보를 확인하고 있습니다
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
            <div className="kiosk-stay-type-options">
              {showOvernight && (
                <button
                  type="button"
                  className="kiosk-stay-type-option is-overnight"
                  onClick={() => handleStayTypeSelect({ type: "overnight", label: "숙박" })}
                >
                  <Moon aria-hidden="true" />
                  <span>
                    <strong>숙박</strong>
                    <small>오늘 입실 · 내일 퇴실</small>
                  </span>
                </button>
              )}

              {showShortStay && (
                <button
                  type="button"
                  className="kiosk-stay-type-option is-short-stay"
                  onClick={() => handleStayTypeSelect({ type: "shortStay", label: "대실" })}
                >
                  <Clock aria-hidden="true" />
                  <span>
                    <strong>대실</strong>
                    <small>잠시 이용</small>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        <nav className="kiosk-home-actions" aria-label="키오스크 주요 메뉴">
          <button
            type="button"
            className="kiosk-home-action kiosk-home-action-reservation"
            onClick={() => onNavigate("reservationConfirm")}
          >
            <CalendarDays aria-hidden="true" />
            <span>이미 예약했어요</span>
          </button>
        </nav>
      </div>
    )
  }

  // Step 2: Room type selection
  if (step === "roomType" && selectedStay) {
    const availableRoomTypes = sortRoomTypes(Object.keys(roomsByType)).filter((roomType) =>
      (roomsByType[roomType] || []).some((room) => hasAvailableStay(room, selectedStay.type)),
    )

    return (
      <KioskProgressScreen steps={ON_SITE_PROGRESS_STEPS} currentStep={0}>
        <div className="kiosk-room-type-screen">
        <header className="kiosk-simple-header">
          <button
            type="button"
            className="kiosk-simple-back"
            onClick={() => {
              setSelectedStay(null)
              setStep("stayType")
            }}
          >
            <ArrowLeft />
            이전
          </button>
          <div>
            <p>{selectedStay.label} 객실</p>
            <h1>객실 타입을 선택해주세요</h1>
          </div>
        </header>

        <div className="kiosk-room-type-list">
          {availableRoomTypes.map((roomType) => {
            const rooms = roomsByType[roomType]
            const sampleRoom = rooms[0]
            const imagePath = getRoomImagePath(roomType, sampleRoom.roomCode)
            const prices = getRoomTypePrices(rooms, selectedStay.type)?.[selectedStay.type]

            return (
              <article key={roomType} className="kiosk-room-type-card">
                <div className="kiosk-room-type-image">
                  <img
                    src={imagePath || "/placeholder.svg"}
                    alt={roomType}
                    onError={(e) => {
                      e.currentTarget.src = "/placeholder.svg?height=360&width=560"
                    }}
                  />
                  <span>{rooms.length}개 이용 가능</span>
                </div>
                <div className="kiosk-room-type-copy">
                  <div>
                    <h2>{roomType}</h2>
                    {prices && <p>{formatPaymentRates(prices)}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRoomTypeSelect(roomType)}
                    aria-label={`${roomType} 선택`}
                  >
                    이 객실 선택
                  </button>
                </div>
              </article>
            )
          })}
        </div>
        </div>
      </KioskProgressScreen>
    )
  }

  // Step 3: Room number selection
  if (step === "roomSelect" && selectedRoomType && selectedStay) {
    const rooms = (roomsByType[selectedRoomType] || []).filter((room) =>
      hasAvailableStay(room, selectedStay.type),
    )
    const roomTypeRates = getRoomTypePrices(rooms, selectedStay.type)?.[selectedStay.type]

    return (
      <KioskProgressScreen steps={ON_SITE_PROGRESS_STEPS} currentStep={0}>
        <div className="kiosk-room-select-screen">
        <header className="kiosk-room-select-header">
          <button
            type="button"
            className="kiosk-room-select-back"
            onClick={() => {
              setSelectedRoomType("")
              setSelectedStay(null)
              setStep("roomType")
            }}
          >
            <ArrowLeft />
            돌아가기
          </button>

          <div className="kiosk-room-select-heading">
            <p>더 비치스테이 {locationName}</p>
            <h1>객실번호를 선택해주세요</h1>
            <span>{selectedRoomType} · {selectedStay.label}</span>
          </div>

          <div
            className={`kiosk-selected-stay-summary ${
              selectedStay.type === "overnight" ? "is-overnight" : "is-short-stay"
            }`}
          >
            {selectedStay.type === "overnight" ? <Moon /> : <Clock />}
            <span>이용금액</span>
            <strong>{roomTypeRates ? formatPaymentRates(roomTypeRates) : "요금 확인 필요"}</strong>
          </div>
        </header>

        <div className="kiosk-room-options" aria-label={`${selectedRoomType} 객실 목록`}>
          {rooms.map((room) => {
            const imagePath = getRoomImagePath(room.roomType, room.roomCode)

            return (
              <button
                type="button"
                key={room.roomCode}
                className="kiosk-room-option"
                onClick={() => handleRoomSelect(room)}
                aria-label={`${room.roomCode}호 선택`}
              >
                <div className="kiosk-room-option-image">
                  <img
                    src={imagePath || "/placeholder.svg"}
                    alt={`${room.roomCode} 객실`}
                    onError={(e) => {
                      e.currentTarget.src = "/placeholder.svg?height=360&width=560"
                    }}
                  />
                  <span>
                    <DoorOpen />
                    선택
                  </span>
                </div>
                <div className="kiosk-room-option-details">
                  <strong>{room.roomCode}</strong>
                  <span>
                    <Home />
                    {locationName} · {room.floor}층
                  </span>
                  <b>{room.roomCode}호 선택</b>
                </div>
              </button>
            )
          })}
        </div>

        {rooms.length === 0 && (
          <div className="kiosk-room-options-empty">
            <AlertTriangle />
            <p>선택 가능한 객실이 없습니다</p>
            <button
              type="button"
              onClick={() => {
                setSelectedRoomType("")
                setSelectedStay(null)
                setStep("roomType")
              }}
            >
              다른 객실 타입 보기
            </button>
          </div>
        )}

        </div>
      </KioskProgressScreen>
    )
  }

  // Step 4: Final confirmation
  if (step === "confirm" && selectedRoom && selectedStay) {
    const rates = selectedRoom.rates?.[selectedStay.type]

    return (
      <KioskProgressScreen steps={ON_SITE_PROGRESS_STEPS} currentStep={1}>
        <main className="kiosk-booking-confirm">
        <header className="kiosk-simple-header">
          <button type="button" className="kiosk-simple-back" onClick={() => setStep("roomSelect")}>
            <ArrowLeft />
            이전
          </button>
          <div>
            <p>선택 내용 확인</p>
            <h1>이대로 결제할까요?</h1>
          </div>
        </header>

        <section className="kiosk-booking-summary">
          <div className="kiosk-booking-summary-check">
            <Check />
          </div>
          <p>{selectedStay.label} · {selectedRoomType}</p>
          <h2>{selectedRoom.roomCode}호</h2>
          <span>{locationName} · {selectedRoom.floor}층</span>
          {rates && <strong>{formatPaymentRates(rates)}</strong>}
        </section>

        <section className="kiosk-booking-smoking">
          <CigaretteOff aria-hidden="true" />
          <div>
            <h2>전 객실은 금연입니다</h2>
            <p>객실 안에서는 담배를 피울 수 없습니다.</p>
          </div>
        </section>

        <div className="kiosk-booking-confirm-actions">
          <button type="button" className="is-secondary" onClick={() => setStep("roomSelect")}>
            객실 다시 선택
          </button>
          <button type="button" className="is-primary" onClick={() => startRoomPayment(selectedRoom)}>
            확인하고 결제하기
          </button>
        </div>
        </main>
      </KioskProgressScreen>
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
    const cardAmount = selectedRates?.card ?? 0
    const cashAmount = selectedRates?.cash ?? 0

    return (
      <KioskProgressScreen steps={ON_SITE_PROGRESS_STEPS} currentStep={2}>
        <PaymentScreen
          cardAmount={cardAmount}
          cashAmount={cashAmount}
          onPaymentComplete={handlePaymentComplete}
          onCancel={handlePaymentCancel}
          title="결제 방법을 선택해주세요"
          description={`${selectedRoomType} · ${selectedStay?.label ?? ""} · ${selectedRoom.roomCode}호`}
        />
      </KioskProgressScreen>
    )
  }

  // Step 5: Completion
  if (step === "complete" && reservationData) {
    return (
      <KioskProgressScreen steps={ON_SITE_PROGRESS_STEPS} currentStep={2}>
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
      </KioskProgressScreen>
    )
  }

  return null
}

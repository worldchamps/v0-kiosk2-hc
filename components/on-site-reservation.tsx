"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Image from "next/image"
import { Phone, Check, X, ArrowRight, Loader2, AlertCircle, RefreshCw, Banknote } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { formatNumberWithCommas } from "@/lib/utils"
import * as BillAcceptor from "@/lib/bill-acceptor-utils"
import * as BillDispenser from "@/lib/bill-dispenser-utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import CheckInComplete from "@/components/check-in-complete"
import { getBeachRoomImage } from "@/lib/room-utils"

// 객실 타입 정의
interface Room {
  roomType: string // Beach A, Beach B 등
  roomNumber: string // 333호, 332호 등
  roomCode: string // A333, Camp502 등
  roomStyle: string // 6개 타입: 스탠다드, 스탠다드 트윈, 디럭스 (오션뷰), 스위트 (오션뷰), 펜트하우스, 독채펜션(마당)
  password: string // 체크인 방법 및 비밀번호
  status: string // 객실상태 (공실, 사용중, 청소대기중)
  floor: string // 층수
  vendingMachineStatus: string // 자판기 판매상태 (O 또는 X)
  keyStatus: string // 키 판매상태 (O 또는 X)
  price: number // 숙박 가격
}

// 건물 타입 정의
type BuildingType = "Beach A" | "Beach B" | "Beach C" | "Beach D" | "Camp"

// 결제 상태 정의
type PaymentStep = "select" | "payment" | "processing" | "change" | "receipt" | "error"

interface OnSiteReservationProps {
  onNavigate: (screen: string) => void
}

export default function OnSiteReservation({ onNavigate }: OnSiteReservationProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType>("Beach A")
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [paymentStep, setPaymentStep] = useState<PaymentStep>("select")
  const [paidAmount, setPaidAmount] = useState(0)
  const [changeAmount, setChangeAmount] = useState(0)
  const [errorMessage, setErrorMessage] = useState("")
  const [deviceStatus, setDeviceStatus] = useState({
    acceptorConnected: false,
    dispenserConnected: false,
  })
  const [processingPayment, setProcessingPayment] = useState(false)
  const [paymentProgress, setPaymentProgress] = useState(0)
  const { toast } = useToast()

  // 타이머 참조
  const billAcceptorTimerRef = useRef<NodeJS.Timeout | null>(null)
  const paymentTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 결제 금액이 충분할 때 자동으로 결제 처리
  useEffect(() => {
    if (paymentStep === "payment" && paidAmount >= (selectedRoom?.price || 0) && !processingPayment) {
      // 약간의 지연 후 결제 처리 시작 (사용자가 금액을 확인할 수 있도록)
      const timer = setTimeout(() => {
        completePayment()
      }, 1500)

      return () => clearTimeout(timer)
    }
  }, [paidAmount, selectedRoom, paymentStep, processingPayment])

  // 객실 정보 가져오기
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        setLoading(true)
        const response = await fetch("/api/room-status")

        if (!response.ok) {
          throw new Error("객실 정보를 가져오는데 실패했습니다.")
        }

        const data = await response.json()
        setRooms(data.rooms || [])
      } catch (error) {
        console.error("객실 정보 로딩 오류:", error)
        toast({
          title: "오류 발생",
          description: "객실 정보를 불러오는데 실패했습니다. 다시 시도해주세요.",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchRooms()
  }, [toast])

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (billAcceptorTimerRef.current) {
        clearInterval(billAcceptorTimerRef.current)
      }
      if (paymentTimeoutRef.current) {
        clearTimeout(paymentTimeoutRef.current)
      }

      // 결제 중이었다면 지폐인식기 비활성화
      if (paymentStep === "payment") {
        BillAcceptor.disableAcceptance().catch(console.error)
      }
    }
  }, [paymentStep])

  // 디바이스 상태 확인
  const checkDeviceStatus = async () => {
    try {
      // 실제 환경에서는 아래 코드를 사용
      // const acceptorConnected = BillAcceptor.isBillAcceptorConnected()
      // const dispenserConnected = BillDispenser.isBillDispenserConnected()

      // 개발 및 테스트를 위해 항상 연결된 것으로 처리
      const acceptorConnected = true
      const dispenserConnected = true

      setDeviceStatus({
        acceptorConnected,
        dispenserConnected,
      })

      return true // 항상 true 반환
    } catch (error) {
      console.error("디바이스 상태 확인 오류:", error)
      // 오류가 발생해도 진행할 수 있도록 true 반환
      return true
    }
  }

  // 선택된 건물의 객실만 필터링 (공실이면서 키오스크 판매 가능한 객실만)
  const filteredRooms = rooms.filter(
    (room) => room.roomType === selectedBuilding && room.status === "공실" && room.vendingMachineStatus === "O",
  )

  // 객실 선택 핸들러
  const handleRoomSelect = async (room: Room) => {
    setSelectedRoom(room)

    // 디바이스 연결 상태 확인
    await checkDeviceStatus()

    // 디바이스 연결 여부와 상관없이 진행
    try {
      // 결제 상태 초기화
      setPaidAmount(0)
      setChangeAmount(0)
      setErrorMessage("")
      setPaymentStep("payment")

      // 지폐인식기 활성화 - 실제 환경에서만 작동하도록 try-catch로 감싸기
      try {
        await BillAcceptor.enableAcceptance()

        // 지폐 카운팅 콜백 설정
        BillAcceptor.setBillCountingCallback((amount) => {
          setPaidAmount((prev) => {
            const newAmount = prev + amount
            console.log(`지폐 ${amount}원 인식됨. 총 금액: ${newAmount}원`)
            return newAmount
          })
        })
      } catch (e) {
        console.log("지폐인식기 활성화 실패 (개발 환경에서는 무시됨)", e)
      }

      // 결제 타임아웃 설정 (3분)
      paymentTimeoutRef.current = setTimeout(
        () => {
          if (paymentStep === "payment") {
            handlePaymentError("결제 시간이 초과되었습니다. 다시 시도해주세요.")
          }
        },
        3 * 60 * 1000,
      )
    } catch (error) {
      console.error("결제 시작 오류:", error)
      handlePaymentError("결제를 시작할 수 없습니다. 다시 시도해주세요.")
    }
  }

  // 결제 완료 처리
  const completePayment = async () => {
    if (!selectedRoom || processingPayment) return

    try {
      // 처리 중 상태로 설정하여 중복 실행 방지
      setProcessingPayment(true)
      setPaymentStep("processing")

      // 지폐인식기 비활성화 - 실제 환경에서만 작동하도록 try-catch로 감싸기
      try {
        await BillAcceptor.disableAcceptance()
      } catch (e) {
        console.log("지폐인식기 비활성화 실패 (개발 환경에서는 무시됨)", e)
      }

      // 결제 처리 시뮬레이션 (실제로는 API 호출 등이 필요)
      const progressInterval = setInterval(() => {
        setPaymentProgress((prev) => {
          if (prev >= 100) {
            clearInterval(progressInterval)
            return 100
          }
          return prev + 10
        })
      }, 200)

      // 결제 처리 시간 (2초)
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // 거스름돈 계산
      const change = paidAmount - selectedRoom.price
      setChangeAmount(change)

      // 거스름돈이 있는 경우
      if (change > 0) {
        setPaymentStep("change")

        // 거스름돈 방출 처리
        await dispenseChange(change)
      } else {
        // 거스름돈이 없는 경우 바로 영수증 화면으로
        setPaymentStep("receipt")
      }

      // 객실 상태 업데이트 API 호출 (실제 구현 필요)
      // await updateRoomStatus(selectedRoom.roomCode, "사용중");

      toast({
        title: "결제 완료",
        description: `${selectedRoom.roomCode} 객실이 성공적으로 예약되었습니다.`,
      })
    } catch (error) {
      console.error("결제 완료 처리 오류:", error)
      handlePaymentError("결제 처리 중 오류가 발생했습니다. 관리자에게 문의하세요.")
    } finally {
      setProcessingPayment(false)
    }
  }

  // 거스름돈 방출 처리
  const dispenseChange = async (amount: number) => {
    try {
      // 만원권 계산
      const billCount = Math.floor(amount / 10000)

      if (billCount > 0) {
        // 지폐방출기로 만원권 방출 - 실제 환경에서만 작동하도록 try-catch로 감싸기
        try {
          // 방출 전 상태 확인 및 초기화
          await BillDispenser.resetDispenser()

          // 단일 명령으로 방출 (중복 방출 방지)
          console.log(`거스름돈 ${billCount}장 방출 시작`)
          const dispensed = await BillDispenser.dispenseBills(billCount)

          if (!dispensed) {
            console.log("거스름돈 방출 실패 (개발 환경에서는 무시됨)")
          } else {
            console.log(`거스름돈 ${billCount}장 방출 완료`)
          }
        } catch (e) {
          console.log("지폐방출기 오류 (개발 환경에서는 무시됨)", e)
        }

        // 방출 완료 대기 (3초)
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }

      // 거스름돈 방출 완료 후 영수증 화면으로 전환
      setPaymentStep("receipt")
    } catch (error) {
      console.error("거스름돈 방출 오류:", error)
      // 거스름돈 방출 실패해도 결제는 완료 처리
      setPaymentStep("receipt")

      toast({
        title: "거스름돈 방출 오류",
        description: "거스름돈 방출에 실패했습니다. 관리자에게 문의하세요.",
        variant: "destructive",
      })
    }
  }

  // 결제 오류 처리
  const handlePaymentError = (message: string) => {
    // 지폐인식기 비활성화
    BillAcceptor.disableAcceptance().catch(console.error)

    // 타이머 정리
    if (billAcceptorTimerRef.current) {
      clearInterval(billAcceptorTimerRef.current)
      billAcceptorTimerRef.current = null
    }

    if (paymentTimeoutRef.current) {
      clearTimeout(paymentTimeoutRef.current)
      paymentTimeoutRef.current = null
    }

    setErrorMessage(message)
    setPaymentStep("error")

    toast({
      title: "결제 오류",
      description: message,
      variant: "destructive",
    })
  }

  // 결제 취소 처리
  const cancelPayment = async () => {
    try {
      // 지폐인식기 비활성화
      await BillAcceptor.disableAcceptance()

      // 타이머 정리
      if (billAcceptorTimerRef.current) {
        clearInterval(billAcceptorTimerRef.current)
        billAcceptorTimerRef.current = null
      }

      if (paymentTimeoutRef.current) {
        clearTimeout(paymentTimeoutRef.current)
        paymentTimeoutRef.current = null
      }

      // 이미 투입된 금액이 있는 경우 거스름돈 방출
      if (paidAmount > 0) {
        setPaymentStep("change")
        await dispenseChange(paidAmount)

        toast({
          title: "결제 취소",
          description: "결제가 취소되었습니다. 투입된 금액이 반환됩니다.",
        })
      } else {
        setPaymentStep("select")
      }
    } catch (error) {
      console.error("결제 취소 오류:", error)
      handlePaymentError("결제 취소 중 오류가 발생했습니다.")
    }
  }

  // 객실 상태 아이콘
  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "O") {
      return <Check className="h-5 w-5 text-green-500" />
    } else {
      return <X className="h-5 w-5 text-red-500" />
    }
  }

  // 결제 단계에 따른 컴포넌트 렌더링
  const renderPaymentStep = () => {
    switch (paymentStep) {
      case "select":
        return (
          <div className="w-full overflow-auto py-6 mt-8">
            <Tabs defaultValue={selectedBuilding} onValueChange={(value) => setSelectedBuilding(value as BuildingType)}>
              <TabsList className="grid grid-cols-5 mb-8">
                <TabsTrigger value="Beach A">A동</TabsTrigger>
                <TabsTrigger value="Beach B">B동</TabsTrigger>
                <TabsTrigger value="Beach C">C동</TabsTrigger>
                <TabsTrigger value="Beach D">D동</TabsTrigger>
                <TabsTrigger value="Camp">Camp</TabsTrigger>
              </TabsList>

              <TabsContent value={selectedBuilding} className="mt-0">
                {loading ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-xl">객실 정보를 불러오는 중...</span>
                  </div>
                ) : filteredRooms.length > 0 ? (
                  <div className="grid grid-cols-1 gap-6 w-full mb-10">
                    {filteredRooms.map((room, index) => (
                      <Card
                        key={index}
                        className="overflow-hidden shadow-md cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => handleRoomSelect(room)}
                      >
                        <div className="flex flex-row h-full">
                          <div className="w-1/3">
                            <Image
                              src={getBeachRoomImage(room.roomStyle, room.roomType) || "/placeholder.svg"}
                              alt={room.roomStyle}
                              width={300}
                              height={200}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                console.log(`이미지 로드 실패: ${e.currentTarget.src}`)
                                e.currentTarget.src = "/placeholder.svg"
                              }}
                            />
                          </div>
                          <CardContent className="p-6 flex-1">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-bold text-left text-3xl mb-2">{room.roomCode}</p>
                                <p className="text-left text-xl mb-4">{room.roomStyle}</p>
                                <div className="flex space-x-4 mb-2">
                                  <div className="flex items-center">
                                    <span className="text-gray-600 mr-2">층수:</span>
                                    <span className="font-medium">{room.floor}층</span>
                                  </div>
                                  <div className="flex items-center">
                                    <span className="text-gray-600 mr-2">자판기:</span>
                                    <StatusIcon status={room.vendingMachineStatus} />
                                  </div>
                                  <div className="flex items-center">
                                    <span className="text-gray-600 mr-2">키:</span>
                                    <StatusIcon status={room.keyStatus} />
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-2xl font-bold text-blue-600">
                                  {formatNumberWithCommas(room.price)}원
                                </p>
                              </div>
                            </div>
                            <Button className="mt-4 w-full">
                              선택하기 <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </CardContent>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card className="w-full mb-10 shadow-md">
                    <CardContent className="p-8 flex flex-col items-center justify-center">
                      <p className="text-xl text-gray-500">현재 이용 가능한 객실이 없습니다.</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>

            <Card className="w-full mb-10 shadow-md">
              <CardContent className="p-8 flex flex-col items-start justify-start space-y-6">
                <Phone className="h-16 w-16 text-gray-400" />

                <div className="text-left">
                  <p className="font-bold text-2xl">예약 문의</p>
                  <p className="text-3xl font-bold">010-5126-4644</p>
                </div>

                <p className="text-left text-gray-700 text-2xl font-bold">추가 문의는 C동 안내실로 오십시오.</p>
              </CardContent>
            </Card>
          </div>
        )

      case "payment":
        return selectedRoom ? (
          <div className="w-full py-6 mt-8">
            <Card className="w-full mb-10 shadow-md">
              <CardContent className="p-8">
                <h2 className="text-2xl font-bold mb-6 text-center">현금 결제</h2>

                <div className="mb-8">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-xl">결제 금액</p>
                    <p className="text-3xl font-bold text-blue-600">{formatNumberWithCommas(selectedRoom.price)}원</p>
                  </div>

                  <div className="flex justify-between items-center mb-4">
                    <p className="text-xl">투입 금액</p>
                    <p className="text-3xl font-bold">{formatNumberWithCommas(paidAmount)}원</p>
                  </div>

                  <div className="flex justify-between items-center">
                    <p className="text-xl">남은 금액</p>
                    <p className="text-3xl font-bold text-red-500">
                      {formatNumberWithCommas(Math.max(0, selectedRoom.price - paidAmount))}원
                    </p>
                  </div>
                </div>

                <div className="bg-blue-50 p-6 rounded-lg mb-8">
                  <div className="flex items-center mb-4">
                    <Banknote className="h-8 w-8 text-blue-500 mr-3" />
                    <p className="text-xl font-bold text-blue-700">지폐를 투입구에 넣어주세요</p>
                  </div>
                  <p className="text-gray-600">
                    1,000원, 5,000원, 10,000원, 50,000원권을 사용할 수 있습니다.
                    <br />
                    지폐는 한 장씩 넣어주세요.
                  </p>
                </div>

                {paidAmount >= selectedRoom.price && (
                  <Alert className="mb-6 bg-green-50 border-green-200">
                    <Check className="h-5 w-5 text-green-500" />
                    <AlertTitle className="text-green-700">결제 금액이 모두 투입되었습니다</AlertTitle>
                    <AlertDescription className="text-green-600">
                      잠시 후 자동으로 결제가 진행됩니다...
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex space-x-4">
                  <Button variant="outline" className="flex-1 h-16 text-xl bg-transparent" onClick={cancelPayment}>
                    결제 취소
                  </Button>
                  <Button
                    className="flex-1 h-16 text-xl"
                    onClick={completePayment}
                    disabled={paidAmount < selectedRoom.price || processingPayment}
                  >
                    {processingPayment ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        처리 중...
                      </>
                    ) : (
                      "결제 완료"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null

      case "processing":
        return (
          <div className="w-full py-6 mt-8">
            <Card className="w-full mb-10 shadow-md">
              <CardContent className="p-8 flex flex-col items-center justify-center">
                <Loader2 className="h-16 w-16 animate-spin text-blue-500 mb-4" />
                <h2 className="text-2xl font-bold mb-4">결제 처리 중</h2>
                <p className="text-gray-500 mb-6">잠시만 기다려주세요...</p>

                <div className="w-full mb-4">
                  <Progress value={paymentProgress} className="h-2" />
                </div>
                <p className="text-sm text-gray-500">{paymentProgress}% 완료</p>
              </CardContent>
            </Card>
          </div>
        )

      case "change":
        return (
          <div className="w-full py-6 mt-8">
            <Card className="w-full mb-10 shadow-md">
              <CardContent className="p-8 flex flex-col items-center justify-center">
                <div className="bg-blue-100 p-4 rounded-full mb-6">
                  <Banknote className="h-16 w-16 text-blue-500" />
                </div>

                <h2 className="text-2xl font-bold mb-4">거스름돈 반환 중</h2>
                <p className="text-gray-500 mb-6">거스름돈을 받아가세요.</p>

                <div className="bg-blue-50 p-6 rounded-lg mb-8 w-full">
                  <div className="flex justify-between items-center">
                    <p className="text-xl">거스름돈</p>
                    <p className="text-3xl font-bold text-blue-600">{formatNumberWithCommas(changeAmount)}원</p>
                  </div>
                </div>

                <Button className="w-full h-16 text-xl" onClick={() => setPaymentStep("receipt")}>
                  완료
                </Button>
              </CardContent>
            </Card>
          </div>
        )

      case "receipt":
        return selectedRoom ? (
          <CheckInComplete
            revealedInfo={{
              roomNumber: selectedRoom.roomCode, // roomCode 사용
              password: selectedRoom.password,
              floor: selectedRoom.floor,
            }}
            reservation={{
              guestName: "현장 결제",
              roomNumber: selectedRoom.roomCode, // roomCode 사용
              roomType: selectedRoom.roomStyle,
              checkInDate: new Date()
                .toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                })
                .replace(/\./g, ".")
                .replace(/ /g, ""),
              checkOutDate: new Date(new Date().setDate(new Date().getDate() + 1))
                .toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                })
                .replace(/\./g, ".")
                .replace(/ /g, ""),
              price: selectedRoom.price,
              reservationId: `ON-${Date.now().toString().slice(-6)}`,
              password: selectedRoom.password,
              floor: selectedRoom.floor,
              buildingType: selectedRoom.roomType, // 건물 타입 추가
            }}
            onNavigate={onNavigate}
          />
        ) : null

      case "error":
        return (
          <div className="w-full py-6 mt-8">
            <Card className="w-full mb-10 shadow-md">
              <CardContent className="p-8 flex flex-col items-center">
                <div className="bg-red-100 p-4 rounded-full mb-6">
                  <AlertCircle className="h-16 w-16 text-red-500" />
                </div>

                <h2 className="text-2xl font-bold mb-4 text-center">결제 오류</h2>
                <p className="text-gray-700 mb-8 text-center">{errorMessage}</p>

                <div className="flex space-x-4 w-full">
                  <Button
                    variant="outline"
                    className="flex-1 h-16 text-xl bg-transparent"
                    onClick={() => onNavigate("standby")}
                  >
                    메인 화면으로
                  </Button>
                  <Button
                    className="flex-1 h-16 text-xl flex items-center justify-center"
                    onClick={() => setPaymentStep("select")}
                  >
                    <RefreshCw className="mr-2 h-5 w-5" />
                    다시 시도
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )
    }
  }

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">더 비치스테이</h1>
          <div className="kiosk-highlight">현장 예약</div>
        </div>

        {renderPaymentStep()}

        {paymentStep === "select" && (
          <Button
            variant="outline"
            onClick={() => onNavigate("standby")}
            className="h-20 text-2xl w-full border-3 border-gray-300 mt-auto font-bold"
          >
            돌아가기
          </Button>
        )}
      </div>
    </div>
  )
}

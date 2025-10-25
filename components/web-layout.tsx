"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import MonthlySalesCalendar from "@/components/monthly-sales-calendar"
import RoomInfo from "@/components/room-info"
import PrinterTest from "@/components/printer-test"
import DirectLinks from "@/components/direct-links"
import BillAcceptorTest from "@/components/bill-acceptor-test"
import BillDispenserTest from "@/components/bill-dispenser-test"

// 샘플 예약 데이터 생성 함수
const getSampleReservations = () => {
  const today = new Date().toISOString().slice(0, 10)
  return [
    {
      place: "A",
      guestName: "김민준",
      reservationId: "R12345",
      bookingPlatform: "야놀자",
      roomType: "스탠다드 더블",
      price: "50000",
      phoneNumber: "010-1234-5678",
      checkInDate: today,
      checkOutDate: today,
      roomNumber: "A101",
      password: "1234",
      checkInStatus: "",
      checkInTime: "",
    },
    {
      place: "B",
      guestName: "박서준",
      reservationId: "R67890",
      bookingPlatform: "여기어때",
      roomType: "디럭스 트윈",
      price: "70000",
      phoneNumber: "010-9876-5432",
      checkInDate: today,
      checkOutDate: today,
      roomNumber: "B202",
      password: "5678",
      checkInStatus: "",
      checkInTime: "",
    },
  ]
}

export default function WebLayout({ onChangeMode }: { onChangeMode: () => void }) {
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Fetch reservations on component mount
  useEffect(() => {
    fetchReservations()
  }, [])

  const fetchReservations = async () => {
    setLoading(true)
    setError(null)
    try {
      // Add timestamp to prevent caching
      const timestamp = new Date().getTime()
      // API 엔드포인트 변경 - admin/reservations 대신 reservations 사용
      const response = await fetch(`/api/reservations?t=${timestamp}`)

      if (!response.ok) {
        console.error(`API error: ${response.status}`)
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      console.log("API response:", data)

      if (data.reservations && Array.isArray(data.reservations)) {
        setReservations(data.reservations)
        console.log(`Fetched ${data.reservations.length} reservations successfully`)
      } else {
        console.warn("API returned no reservations or invalid format, using sample data")
        setReservations(getSampleReservations())
      }
    } catch (error) {
      console.error("Error fetching reservations:", error)
      setError("예약 데이터를 불러오는 중 오류가 발생했습니다.")
      // 오류 발생 시 샘플 데이터 사용
      console.log("Using sample data due to error")
      setReservations(getSampleReservations())
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-gray-100 p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">관리자 모드</h1>
        <Button onClick={onChangeMode} variant="outline">
          모드 변경
        </Button>
      </header>

      <main className="flex-grow p-4 overflow-auto">
        <Tabs defaultValue="reservations" className="w-full">
          <TabsList>
            <TabsTrigger value="reservations">예약 관리</TabsTrigger>
            <TabsTrigger value="roomInfo">객실 정보</TabsTrigger>
            <TabsTrigger value="sales">매출 현황</TabsTrigger>
            <TabsTrigger value="printer">프린터 테스트</TabsTrigger>
            <TabsTrigger value="billAcceptor">지폐 인식기</TabsTrigger>
            <TabsTrigger value="billDispenser">지폐 방출기</TabsTrigger>
            <TabsTrigger value="links">바로 가기 링크</TabsTrigger>
          </TabsList>
          <TabsContent value="reservations" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>예약 목록</CardTitle>
              </CardHeader>
              <CardContent>
                {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}
                {loading ? (
                  <div>Loading reservations...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            이름
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            객실 번호
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            체크인
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            상태
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {reservations.map((reservation) => (
                          <tr key={reservation.reservationId}>
                            <td className="px-6 py-4 whitespace-nowrap">{reservation.guestName}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{reservation.roomNumber}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{reservation.checkInDate}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{reservation.checkInStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="roomInfo">
            <RoomInfo reservations={reservations} />
          </TabsContent>
          <TabsContent value="sales">
            <MonthlySalesCalendar />
          </TabsContent>
          <TabsContent value="printer">
            <PrinterTest />
          </TabsContent>
          <TabsContent value="billAcceptor">
            <BillAcceptorTest />
          </TabsContent>
          <TabsContent value="billDispenser">
            <BillDispenserTest />
          </TabsContent>
          <TabsContent value="links">
            <DirectLinks />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

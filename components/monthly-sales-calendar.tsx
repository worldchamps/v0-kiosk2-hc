"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react"

interface SalesData {
  checkInDate: string
  price: string
  roomType: string
  guestName: string
  checkInStatus: string
  place?: string
  reservationId?: string
}

interface MonthlySalesCalendarProps {
  initialSalesData?: SalesData[]
}

export default function MonthlySalesCalendar({ initialSalesData = [] }: MonthlySalesCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [salesData, setSalesData] = useState<SalesData[]>(initialSalesData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 현재 월의 첫 날과 마지막 날 구하기
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

  // 달력에 표시할 날짜 배열 생성
  const daysInMonth = lastDayOfMonth.getDate()
  const firstDayOfWeek = firstDayOfMonth.getDay() // 0: 일요일, 1: 월요일, ...

  // Fetch sales data when month changes
  useEffect(() => {
    fetchSalesData()
  }, [currentDate])

  // Fetch sales data from the API
  const fetchSalesData = async () => {
    setLoading(true)
    setError(null)

    try {
      const month = currentDate.getMonth() + 1 // JavaScript months are 0-indexed
      const year = currentDate.getFullYear()

      console.log(`Fetching sales data for ${year}-${month}`)

      // API 요청에 타임스탬프 추가하여 캐싱 방지
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/sales?month=${month}&year=${year}&t=${timestamp}`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      console.log("Sales API response:", data)

      if (data.sales && Array.isArray(data.sales)) {
        console.log(`Received ${data.sales.length} sales records`)
        setSalesData(data.sales)

        // 데이터 처리 로직 디버깅
        if (data.sales.length > 0) {
          console.log("Sample sales data:", data.sales[0])
          console.log("Price format example:", data.sales[0].price)
        }
      } else {
        console.warn("No sales data returned or invalid format")
        setSalesData([])
      }
    } catch (err) {
      console.error("Error fetching sales data:", err)
      setError("매출 데이터를 불러오는 중 오류가 발생했습니다.")
      // Keep existing data if there's an error
    } finally {
      setLoading(false)
    }
  }

  // 이전 달로 이동
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  // 다음 달로 이동
  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  // 날짜별 매출 계산
  const dailySales = {}

  // 예약 데이터를 기반으로 날짜별 매출 계산
  salesData.forEach((sale) => {
    const checkInDate = sale.checkInDate
    if (!checkInDate) return

    try {
      // 현재 표시 중인 월에 해당하는 예약만 필터링
      const saleDate = new Date(checkInDate)
      if (saleDate.getFullYear() === currentDate.getFullYear() && saleDate.getMonth() === currentDate.getMonth()) {
        const day = saleDate.getDate()

        // 가격에서 숫자만 추출 - 다양한 형식 처리
        const priceString = sale.price || "0"
        let price = 0

        // 가격 문자열에서 숫자만 추출하는 로직 개선
        const numericValue = priceString.replace(/[^0-9]/g, "")
        if (numericValue) {
          price = Number.parseInt(numericValue, 10)
          // 디버깅 로그
          console.log(`Extracted price for ${checkInDate}: ${price} from "${priceString}"`)
        } else {
          console.warn(`Could not extract numeric price from "${priceString}"`)
        }

        if (!dailySales[day]) {
          dailySales[day] = {
            total: 0,
            count: 0,
            sales: [],
          }
        }

        dailySales[day].total += price
        dailySales[day].count += 1
        dailySales[day].sales.push(sale)
      }
    } catch (err) {
      console.error(`Error processing sale date ${checkInDate}:`, err)
    }
  })

  // 월 이름 배열
  const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"]

  // 요일 이름 배열
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"]

  // 월 총 매출 계산
  const monthlyTotal = Object.values(dailySales).reduce((sum: number, day: any) => sum + day.total, 0)

  // 월 총 예약 수 계산
  const monthlySalesCount = Object.values(dailySales).reduce((sum: number, day: any) => sum + day.count, 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl">
            {currentDate.getFullYear()}년 {monthNames[currentDate.getMonth()]} 매출 현황 (CheckoutedReservation)
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={fetchSalesData} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">월 총 매출</p>
                <p className="text-2xl font-bold">{monthlyTotal.toLocaleString()}원</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">월 총 예약 수</p>
                <p className="text-2xl font-bold">{monthlySalesCount}건</p>
              </CardContent>
            </Card>
          </div>

          {loading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">매출 데이터를 불러오는 중...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1">
                {/* 요일 헤더 */}
                {dayNames.map((day, index) => (
                  <div
                    key={`header-${index}`}
                    className={`text-center py-2 font-medium text-sm ${
                      index === 0 ? "text-red-500" : index === 6 ? "text-blue-500" : ""
                    }`}
                  >
                    {day}
                  </div>
                ))}

                {/* 빈 칸 채우기 (이전 달) */}
                {Array.from({ length: firstDayOfWeek }).map((_, index) => (
                  <div key={`empty-start-${index}`} className="h-24 bg-gray-50 rounded-md"></div>
                ))}

                {/* 날짜 채우기 */}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1
                  const dayData = dailySales[day] || { total: 0, count: 0, sales: [] }
                  const isToday =
                    new Date().getDate() === day &&
                    new Date().getMonth() === currentDate.getMonth() &&
                    new Date().getFullYear() === currentDate.getFullYear()

                  return (
                    <div
                      key={`day-${day}`}
                      className={`h-24 p-1 border rounded-md ${
                        isToday ? "border-blue-500 bg-blue-50" : "border-gray-200"
                      } overflow-hidden`}
                    >
                      <div className="flex justify-between items-start">
                        <span
                          className={`text-sm font-medium ${
                            (firstDayOfWeek + day - 1) % 7 === 0
                              ? "text-red-500"
                              : (firstDayOfWeek + day - 1) % 7 === 6
                                ? "text-blue-500"
                                : ""
                          }`}
                        >
                          {day}
                        </span>
                        {dayData.count > 0 && (
                          <span className="text-xs bg-green-100 text-green-800 px-1 rounded">{dayData.count}건</span>
                        )}
                      </div>
                      {dayData.total > 0 && (
                        <div className="mt-1">
                          <p className="text-xs font-medium text-green-600">{dayData.total.toLocaleString()}원</p>
                          <div className="mt-1 space-y-1">
                            {dayData.sales.slice(0, 2).map((sale, idx) => (
                              <p key={idx} className="text-xs truncate text-gray-600">
                                {sale.guestName} ({sale.roomType.split(" ")[0]})
                              </p>
                            ))}
                            {dayData.sales.length > 2 && (
                              <p className="text-xs text-gray-500">+{dayData.sales.length - 2}건 더 있음</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* 빈 칸 채우기 (다음 달) */}
                {Array.from({ length: (7 - ((firstDayOfWeek + daysInMonth) % 7)) % 7 }).map((_, index) => (
                  <div key={`empty-end-${index}`} className="h-24 bg-gray-50 rounded-md"></div>
                ))}
              </div>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>일별 매출 상세</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(dailySales)
                      .sort(([dayA], [dayB]) => Number.parseInt(dayA) - Number.parseInt(dayB))
                      .map(([day, data]: [string, any]) => (
                        <div key={`detail-${day}`} className="flex justify-between items-center p-2 border-b">
                          <div>
                            <p className="font-medium">
                              {currentDate.getFullYear()}년 {monthNames[currentDate.getMonth()]} {day}일
                            </p>
                            <p className="text-sm text-gray-500">예약 {data.count}건</p>
                          </div>
                          <p className="font-bold text-green-600">{data.total.toLocaleString()}원</p>
                        </div>
                      ))}

                    {Object.keys(dailySales).length === 0 && (
                      <p className="text-center py-4 text-gray-500">이번 달 매출 데이터가 없습니다.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

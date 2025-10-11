"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import KoreanKeyboard from "./korean-keyboard"

interface SelfCheckInProps {
  onNavigate: (screen: string) => void
}

export default function SelfCheckIn({ onNavigate }: SelfCheckInProps) {
  const [reservationCode, setReservationCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleCheckIn = async () => {
    if (!reservationCode.trim()) return

    setLoading(true)
    setError("")

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // For demo purposes, let's assume success
      onNavigate("checkInComplete")
    } catch (err) {
      setError("체크인 중 오류가 발생했습니다. 다시 시도해 주세요.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-6 h-full w-full max-w-[27cm] max-h-[42cm] mx-auto px-6 py-8">
      <div className="text-center mb-2">
        <h2 className="text-lg font-medium text-gray-600">더 비치 스테이</h2>
        <h1 className="text-3xl font-bold text-gray-800">셀프 체크인</h1>
        <p className="text-sm text-gray-500 mt-1">The Beach Stay - Self Check-in</p>
      </div>

      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="reservationCode" className="text-lg font-medium">
              예약 코드 입력
            </label>
            <Input
              id="reservationCode"
              value={reservationCode}
              onChange={(e) => setReservationCode(e.target.value)}
              placeholder="예약 코드를 입력하세요"
              className="h-12 text-lg"
              disabled={loading}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <div className="mt-4">
            <KoreanKeyboard
              text={reservationCode}
              setText={setReservationCode}
              onEnter={handleCheckIn}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <Button
              onClick={handleCheckIn}
              disabled={!reservationCode.trim() || loading}
              size="lg"
              className="bg-blue-500 hover:bg-blue-600"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  처리 중...
                </>
              ) : (
                "체크인 하기"
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                onNavigate("standby")
                setReservationCode("")
              }}
              size="lg"
              disabled={loading}
            >
              돌아가기
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

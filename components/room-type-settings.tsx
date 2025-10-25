"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Settings, GripVertical, RotateCcw } from "lucide-react"
import { getRoomTypeOrder, setRoomTypeOrder, DEFAULT_ROOM_TYPE_ORDER, type RoomTypeOrder } from "@/lib/room-type-order"

export default function RoomTypeSettings() {
  const [roomTypeOrder, setRoomTypeOrderState] = useState<RoomTypeOrder>({})
  const [status, setStatus] = useState("")

  useEffect(() => {
    setRoomTypeOrderState(getRoomTypeOrder())
  }, [])

  const handleOrderChange = (roomType: string, newOrder: number) => {
    const updated = {
      ...roomTypeOrder,
      [roomType]: newOrder,
    }
    setRoomTypeOrderState(updated)
  }

  const handleSave = () => {
    setRoomTypeOrder(roomTypeOrder)
    setStatus("객실 타입 정렬 순서가 저장되었습니다.")
    setTimeout(() => setStatus(""), 3000)
  }

  const handleReset = () => {
    setRoomTypeOrderState(DEFAULT_ROOM_TYPE_ORDER)
    setRoomTypeOrder(DEFAULT_ROOM_TYPE_ORDER)
    setStatus("기본 설정으로 초기화되었습니다.")
    setTimeout(() => setStatus(""), 3000)
  }

  const sortedRoomTypes = Object.entries(roomTypeOrder).sort(([, a], [, b]) => a - b)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          객실 타입 정렬 설정
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <div className="p-3 rounded-md bg-green-50 text-green-700">
            <span>{status}</span>
          </div>
        )}

        <div className="bg-gray-50 p-4 rounded-md">
          <p className="text-sm text-gray-600">
            숫자가 작을수록 먼저 표시됩니다. 현장예약 화면에서 객실 타입이 이 순서대로 나타납니다.
          </p>
        </div>

        <div className="space-y-2">
          {sortedRoomTypes.map(([roomType, order]) => (
            <div key={roomType} className="flex items-center gap-3 p-3 bg-white border rounded-md">
              <GripVertical className="h-5 w-5 text-gray-400" />
              <div className="flex-1">
                <span className="font-medium">{roomType}</span>
              </div>
              <Input
                type="number"
                value={order}
                onChange={(e) => handleOrderChange(roomType, Number.parseInt(e.target.value) || 0)}
                className="w-20"
                min="1"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-4">
          <Button onClick={handleSave} className="flex-1">
            저장
          </Button>
          <Button onClick={handleReset} variant="outline" className="flex items-center gap-2 bg-transparent">
            <RotateCcw className="h-4 w-4" />
            초기화
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Loader2, Printer, Building, Search } from "lucide-react"
import { connectPrinter, printRoomInfoReceipt, disconnectPrinter } from "@/lib/printer-utils"

interface Room {
  building: string
  roomNumber: string
  roomType: string
  status: string
  price: string
  floor: string
}

interface RoomInfoProps {
  reservations?: any[]
}

export default function RoomInfo({ reservations = [] }: RoomInfoProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchRoomNumber, setSearchRoomNumber] = useState("")
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null)
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const [printSuccess, setPrintSuccess] = useState<boolean | null>(null)

  // Fetch room data when component mounts
  useEffect(() => {
    fetchRoomData()
  }, [])

  // Fetch room data from the API
  const fetchRoomData = async () => {
    setLoading(true)
    setError(null)

    try {
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/room-status?t=${timestamp}`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      console.log("Room status API response:", data)

      if (data.rooms && Array.isArray(data.rooms)) {
        setRooms(data.rooms)
        console.log(`Fetched ${data.rooms.length} rooms successfully`)
      } else {
        console.warn("API returned no room data or invalid format")
        setRooms([])
      }
    } catch (err) {
      console.error("Error fetching room data:", err)
      setError("객실 정보를 불러오는 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  // Get unique buildings from room data
  const buildings = Array.from(new Set(rooms.map((room) => room.building))).sort()

  // Get unique floors from room data (filtered by selected building if applicable)
  const floors = Array.from(
    new Set(rooms.filter((room) => !selectedBuilding || room.building === selectedBuilding).map((room) => room.floor)),
  ).sort()

  // Filter rooms based on search criteria
  const filteredRooms = rooms.filter((room) => {
    const matchesRoomNumber = searchRoomNumber ? room.roomNumber.includes(searchRoomNumber) : true
    const matchesBuilding = selectedBuilding ? room.building === selectedBuilding : true
    const matchesFloor = selectedFloor ? room.floor === selectedFloor : true
    return matchesRoomNumber && matchesBuilding && matchesFloor
  })

  // Handle room selection
  const handleSelectRoom = (room: Room) => {
    setSelectedRoom(room)
  }

  // Handle print receipt
  const handlePrintReceipt = async () => {
    if (!selectedRoom) return

    setIsPrinting(true)
    setPrintSuccess(null)

    try {
      // Find matching reservation for the selected room
      const matchingReservation = reservations.find(
        (res) => res.roomNumber === selectedRoom.roomNumber && res.place === selectedRoom.building,
      )

      // Prepare receipt data
      const receiptData = {
        roomNumber: selectedRoom.roomNumber,
        floor: selectedRoom.floor,
        password: matchingReservation?.password || "0000", // Use reservation password if available
        roomType: selectedRoom.roomType,
        checkInDate: matchingReservation?.checkInDate || new Date().toISOString().split("T")[0],
        checkOutDate: matchingReservation?.checkOutDate || new Date().toISOString().split("T")[0],
      }

      // Connect to printer and print receipt
      const connected = await connectPrinter()
      if (!connected) {
        throw new Error("프린터 연결에 실패했습니다.")
      }

      const success = await printRoomInfoReceipt(receiptData)
      setPrintSuccess(success)

      if (success) {
        console.log("객실 정보 영수증이 성공적으로 인쇄되었습니다.")
      } else {
        throw new Error("영증 인쇄에 실패했습니다.")
      }
    } catch (err) {
      console.error("영수증 인쇄 오류:", err)
      setError("영수증 인쇄 중 오류가 발생했습니다: " + (err instanceof Error ? err.message : String(err)))
      setPrintSuccess(false)
    } finally {
      await disconnectPrinter()
      setIsPrinting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl">객실 정보 관리</CardTitle>
          <Button onClick={fetchRoomData} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "새로고침"}
          </Button>
        </CardHeader>
        <CardContent>
          {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

          {printSuccess === true && (
            <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-md">
              객실 정보 영수증이 성공적으로 인쇄되었습니다.
            </div>
          )}

          {printSuccess === false && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
              영수증 인쇄에 실패했습니다. 프린터 연결을 확인해주세요.
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1">
              <Input
                placeholder="객실 번호로 검색"
                value={searchRoomNumber}
                onChange={(e) => setSearchRoomNumber(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="flex gap-2">
              <select
                className="border rounded px-3 py-2 w-32"
                value={selectedBuilding || ""}
                onChange={(e) => setSelectedBuilding(e.target.value || null)}
              >
                <option value="">모든 건물</option>
                {buildings.map((building) => (
                  <option key={building} value={building}>
                    {building}동
                  </option>
                ))}
              </select>

              <select
                className="border rounded px-3 py-2 w-32"
                value={selectedFloor || ""}
                onChange={(e) => setSelectedFloor(e.target.value || null)}
              >
                <option value="">모든 층</option>
                {floors.map((floor) => (
                  <option key={floor} value={floor}>
                    {floor}
                  </option>
                ))}
              </select>

              <Button
                variant="outline"
                onClick={() => {
                  setSearchRoomNumber("")
                  setSelectedBuilding(null)
                  setSelectedFloor(null)
                }}
              >
                필터 초기화
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="col-span-2">
              <h3 className="font-medium mb-2">객실 목록 ({filteredRooms.length}개)</h3>
              <div className="border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          건물
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          객실 번호
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          객실 타입
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          상태
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          층
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          가격
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                          </td>
                        </tr>
                      ) : filteredRooms.length > 0 ? (
                        filteredRooms.map((room, index) => (
                          <tr
                            key={`${room.building}-${room.roomNumber}`}
                            className={`hover:bg-gray-50 cursor-pointer ${selectedRoom?.roomNumber === room.roomNumber && selectedRoom?.building === room.building ? "bg-blue-50" : ""}`}
                            onClick={() => handleSelectRoom(room)}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">{room.building}동</td>
                            <td className="px-6 py-4 whitespace-nowrap">{room.roomNumber}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{room.roomType}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{room.status}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{room.floor}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{room.price}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                            검색 결과가 없습니다
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-span-1">
              <h3 className="font-medium mb-2">객실 상세 정보</h3>
              <Card>
                <CardContent className="p-4">
                  {selectedRoom ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center bg-gray-100 rounded-md p-6">
                        <Building className="h-16 w-16 text-gray-400" />
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-sm text-gray-500">건물</p>
                            <p className="font-medium">{selectedRoom.building}동</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">객실 번호</p>
                            <p className="font-medium">{selectedRoom.roomNumber}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-sm text-gray-500">객실 타입</p>
                          <p className="font-medium">{selectedRoom.roomType}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-sm text-gray-500">층</p>
                            <p className="font-medium">{selectedRoom.floor}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">가격</p>
                            <p className="font-medium">{selectedRoom.price}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-sm text-gray-500">상태</p>
                          <p className="font-medium">{selectedRoom.status}</p>
                        </div>
                      </div>

                      <Button className="w-full" onClick={handlePrintReceipt} disabled={isPrinting}>
                        {isPrinting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            인쇄 중...
                          </>
                        ) : (
                          <>
                            <Printer className="mr-2 h-4 w-4" />
                            객실 정보 영수증 인쇄
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Search className="h-12 w-12 mx-auto text-gray-300 mb-2" />
                      <p>객실을 선택하면 상세 정보가 표시됩니다</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

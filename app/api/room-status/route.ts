import { type NextRequest, NextResponse } from "next/server"
import { getGoogleSheetsData } from "@/lib/google-sheets"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const location = searchParams.get("location")

    console.log("Fetching room status for location:", location)

    // Beach Room Status 시트에서 데이터 가져오기
    const data = await getGoogleSheetsData("Beach Room Status!A:M")

    if (!data || data.length < 2) {
      return NextResponse.json({
        success: false,
        error: "No data found in Beach Room Status sheet",
        rooms: [],
      })
    }

    const headers = data[0]
    const rows = data.slice(1)

    console.log("Headers:", headers)
    console.log("Total rows:", rows.length)

    // 헤더 인덱스 찾기
    const roomNumberIndex = headers.findIndex((h) => h === "RoomNumber")
    const buildingTypeIndex = headers.findIndex((h) => h === "BuildingType")
    const roomTypeIndex = headers.findIndex((h) => h === "RoomType")
    const priceIndex = headers.findIndex((h) => h === "Price")
    const roomStatusIndex = headers.findIndex((h) => h === "객실상태") // E열
    const salesAvailableIndex = headers.findIndex((h) => h === "판매 가능 유무") // H열
    const vendingAvailableIndex = headers.findIndex((h) => h === "자판기 판매상태") // I열
    const roomCodeIndex = headers.findIndex((h) => h === "RoomCode")

    console.log("Column indices:", {
      roomNumber: roomNumberIndex,
      buildingType: buildingTypeIndex,
      roomType: roomTypeIndex,
      price: priceIndex,
      roomStatus: roomStatusIndex,
      salesAvailable: salesAvailableIndex,
      vendingAvailable: vendingAvailableIndex,
      roomCode: roomCodeIndex,
    })

    // 데이터 필터링 및 변환
    const availableRooms = rows
      .filter((row) => {
        // 필수 데이터가 있는지 확인
        const hasRequiredData =
          row[roomNumberIndex] && row[buildingTypeIndex] && row[roomTypeIndex] && row[priceIndex] && row[roomCodeIndex]

        if (!hasRequiredData) return false

        // 객실 상태가 "공실"인지 확인
        const isVacant = row[roomStatusIndex] === "공실"

        // 판매 가능 유무가 "O"인지 확인 (H열)
        const isSalesAvailable = row[salesAvailableIndex] === "O"

        // 자판기 판매상태가 "O"인지 확인 (I열) - 새로 추가된 조건
        const isVendingAvailable = row[vendingAvailableIndex] === "O"

        // 위치별 필터링
        let matchesLocation = true
        if (location && location !== "ALL") {
          const buildingType = row[buildingTypeIndex]
          if (location === "A" && !buildingType.includes("Beach A")) matchesLocation = false
          else if (location === "B" && !buildingType.includes("Beach B")) matchesLocation = false
          else if (location === "D" && !buildingType.includes("Beach D")) matchesLocation = false
          else if (location === "CAMP" && !buildingType.includes("Camp")) matchesLocation = false
        }

        const result = hasRequiredData && isVacant && isSalesAvailable && isVendingAvailable && matchesLocation

        if (result) {
          console.log("Available room:", {
            roomNumber: row[roomNumberIndex],
            roomCode: row[roomCodeIndex],
            buildingType: row[buildingTypeIndex],
            roomType: row[roomTypeIndex],
            price: row[priceIndex],
            roomStatus: row[roomStatusIndex],
            salesAvailable: row[salesAvailableIndex],
            vendingAvailable: row[vendingAvailableIndex],
          })
        }

        return result
      })
      .map((row) => ({
        roomNumber: row[roomNumberIndex],
        roomCode: row[roomCodeIndex],
        buildingType: row[buildingTypeIndex],
        roomType: row[roomTypeIndex],
        price: Number.parseInt(row[priceIndex].toString().replace(/[^0-9]/g, "")) || 0,
        roomStatus: row[roomStatusIndex],
        salesAvailable: row[salesAvailableIndex],
        vendingAvailable: row[vendingAvailableIndex],
      }))

    console.log("Filtered available rooms:", availableRooms.length)

    return NextResponse.json({
      success: true,
      rooms: availableRooms,
      total: availableRooms.length,
      debug: {
        totalRows: rows.length,
        filteredRooms: availableRooms.length,
        location: location,
        headers: headers,
      },
    })
  } catch (error) {
    console.error("Error fetching room status:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch room status",
        rooms: [],
      },
      { status: 500 },
    )
  }
}

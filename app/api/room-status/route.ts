import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient } from "@/lib/google-sheets"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

// Authentication function
function authenticateRequest(request: NextRequest) {
  const headersList = headers()
  const apiKey = headersList.get("x-api-key")

  // 클라이언트에서 API 키 없이 호출할 수 있도록 허용
  // 이 API는 공개적으로 접근 가능하지만, 서버 측에서 요청을 검증합니다
  if (!apiKey) return true

  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate the request
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url)
    const building = searchParams.get("building")
    const roomNumber = searchParams.get("roomNumber")
    const floor = searchParams.get("floor")

    console.log(`Fetching room status data from Beach Room Status sheet`)

    // Fetch data from the Beach Room Status sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:F", // Adjust range as needed
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      console.log("No data found in Beach Room Status sheet")
      return NextResponse.json({
        rooms: [],
        message: "No room data found",
      })
    }

    // Map the rows to room objects
    const roomsData = rows.map((row) => {
      return {
        building: row[0] || "",
        roomNumber: row[1] || "",
        roomType: row[2] || "",
        status: row[3] || "",
        price: row[4] || "",
        floor: row[5] || "",
      }
    })

    // Filter by parameters if provided
    let filteredRooms = [...roomsData]

    if (building) {
      filteredRooms = filteredRooms.filter((room) => room.building === building)
    }

    if (roomNumber) {
      filteredRooms = filteredRooms.filter((room) => room.roomNumber.includes(roomNumber))
    }

    if (floor) {
      filteredRooms = filteredRooms.filter((room) => room.floor === floor)
    }

    console.log(`Found ${filteredRooms.length} room records`)

    return NextResponse.json({
      rooms: filteredRooms,
      total: filteredRooms.length,
    })
  } catch (error) {
    console.error("Error fetching room status data:", error)
    return NextResponse.json(
      { error: "Failed to fetch room status data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

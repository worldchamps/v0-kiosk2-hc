import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"

export async function GET(request: NextRequest) {
  try {
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const building = searchParams.get("building")
    const roomNumber = searchParams.get("roomNumber")
    const floor = searchParams.get("floor")

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:F",
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        rooms: [],
        message: "No room data found",
      })
    }

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

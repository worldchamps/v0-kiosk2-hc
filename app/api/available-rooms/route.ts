import { NextResponse } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const location = searchParams.get("location")?.toUpperCase()

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:G",
    })

    const rows = response.data.values

    console.log("[v0] Total rows fetched:", rows?.length || 0)
    console.log("[v0] Filtering by location:", location || "ALL")

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        availableRooms: [],
        message: "No room data found",
      })
    }

    const availableRooms = rows
      .map((row) => {
        const room = {
          building: row[0] || "", // A열: Building type
          roomNumber: row[1] || "", // B열: Room number (###호)
          roomType: row[2] || "", // C열: Room Type
          password: row[3] || "", // D열: Password
          status: (row[4] || "").trim(), // E열: Status
          floor: row[5] || "", // F열: Floor
          roomCode: row[6] || "", // G열: Room code (unique identifier)
        }
        return room
      })
      .filter((room) => {
        // Filter by status
        if (room.status !== "공실") return false

        // Filter by location if specified
        if (location) {
          if (location === "CAMP") {
            // CAMP location shows only Camp rooms
            return room.building === "Camp"
          } else if (["A", "B", "D"].includes(location)) {
            // A, B, D locations show Beach A and Beach B rooms (Property3)
            return room.building === "Beach A" || room.building === "Beach B"
          }
        }

        return true
      })

    console.log("[v0] Available rooms after filter:", availableRooms.length)

    // Group by room type
    const roomsByType = availableRooms.reduce(
      (acc, room) => {
        if (!acc[room.roomType]) {
          acc[room.roomType] = []
        }
        acc[room.roomType].push(room)
        return acc
      },
      {} as Record<string, typeof availableRooms>,
    )

    return NextResponse.json({
      availableRooms,
      roomsByType,
      total: availableRooms.length,
      location: location || "ALL",
    })
  } catch (error) {
    console.error("Error fetching available rooms:", error)
    return NextResponse.json(
      { error: "Failed to fetch available rooms", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

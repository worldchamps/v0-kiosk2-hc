import { NextResponse } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"

export async function GET() {
  try {
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // Fetch room status data from Beach Room Status sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:F",
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        availableRooms: [],
        message: "No room data found",
      })
    }

    // Parse and filter available rooms (status = "공실")
    const availableRooms = rows
      .map((row) => ({
        building: row[0] || "",
        roomNumber: row[1] || "",
        roomType: row[2] || "",
        status: row[3] || "",
        price: row[4] || "",
        floor: row[5] || "",
      }))
      .filter((room) => room.status === "공실")

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
    })
  } catch (error) {
    console.error("Error fetching available rooms:", error)
    return NextResponse.json(
      { error: "Failed to fetch available rooms", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

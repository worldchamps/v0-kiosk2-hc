import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient } from "@/lib/google-sheets"

const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

function authenticateRequest() {
  const headersList = headers()
  const apiKey = headersList.get("x-api-key")
  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

export async function POST(request: NextRequest) {
  try {
    if (!authenticateRequest()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { roomNumber, status } = body

    if (!roomNumber || !status) {
      return NextResponse.json({ error: "Room number and status are required" }, { status: 400 })
    }

    const validStatuses = ["vacant", "occupied", "cleaning", "maintenance"]
    if (!validStatuses.includes(status.toLowerCase())) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      )
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Beach Room Status!A2:G",
    })

    const rows = response.data.values
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No room data found" }, { status: 404 })
    }

    let rowIndex = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][1] === roomNumber) {
        // Column B (index 1) is room number
        rowIndex = i + 2 // +2 because we start at A2 (1-indexed, skip header)
        break
      }
    }

    if (rowIndex === -1) {
      return NextResponse.json({ error: `Room ${roomNumber} not found in Beach Room Status` }, { status: 404 })
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Beach Room Status!D${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[status]],
      },
    })

    console.log(`[v0] Updated Beach Room Status: ${roomNumber} → ${status}`)

    return NextResponse.json({
      success: true,
      message: "Room status updated successfully",
      data: {
        roomNumber,
        status,
        rowIndex,
      },
    })
  } catch (error) {
    console.error("[v0] Error updating room status:", error)
    return NextResponse.json(
      { error: "Failed to update room status", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

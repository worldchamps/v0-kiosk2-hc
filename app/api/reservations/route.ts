import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { getCurrentDateKST, normalizeDate } from "@/lib/date-utils"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const guestName = searchParams.get("name")
    const todayOnly = searchParams.get("todayOnly") === "true"

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const searchResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A94:C",
    })

    const searchRows = searchResponse.data.values

    if (!searchRows || searchRows.length === 0) {
      return NextResponse.json({
        reservations: [],
        today: getCurrentDateKST(),
        message: "No reservations found in the spreadsheet",
      })
    }

    const matchingRowNumbers: number[] = []

    searchRows.forEach((row, index) => {
      const rowGuestName = row[1] || "" // Column B (index 1)

      // If searching by name, only include matching names
      if (guestName) {
        if (rowGuestName === guestName) {
          matchingRowNumbers.push(94 + index) // Actual row number (starting from 94)
        }
      } else {
        // If no name filter, include all rows
        matchingRowNumbers.push(94 + index)
      }
    })

    if (matchingRowNumbers.length === 0) {
      return NextResponse.json({
        reservations: [],
        today: getCurrentDateKST(),
        message: guestName ? `No reservations found for guest: ${guestName}` : "No reservations found",
      })
    }

    const reservations = []
    const today = getCurrentDateKST()

    for (const rowNumber of matchingRowNumbers) {
      const detailResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `Reservations!A${rowNumber}:N${rowNumber}`,
      })

      const row = detailResponse.data.values?.[0]
      if (!row) continue

      const checkInDate = row[SHEET_COLUMNS.CHECK_IN_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_IN_DATE]) : ""
      const checkOutDate = row[SHEET_COLUMNS.CHECK_OUT_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_OUT_DATE]) : ""
      const checkInStatus = row[SHEET_COLUMNS.CHECK_IN_STATUS] || ""

      // Filter: skip if already checked in
      if (checkInStatus && checkInStatus.trim() !== "") {
        continue
      }

      // Filter: if todayOnly, skip if check-in date is before today
      if (todayOnly && checkInDate < today) {
        continue
      }

      reservations.push({
        place: row[SHEET_COLUMNS.PLACE] || "",
        guestName: row[SHEET_COLUMNS.GUEST_NAME] || "",
        reservationId: row[SHEET_COLUMNS.RESERVATION_ID] || "",
        bookingPlatform: row[SHEET_COLUMNS.BOOKING_PLATFORM] || "",
        roomType: row[SHEET_COLUMNS.ROOM_TYPE] || "",
        price: row[SHEET_COLUMNS.PRICE] || "",
        phoneNumber: row[SHEET_COLUMNS.PHONE_NUMBER] || "",
        checkInDate: checkInDate,
        checkOutDate: checkOutDate,
        roomNumber: row[SHEET_COLUMNS.ROOM_NUMBER] || "",
        password: row[SHEET_COLUMNS.PASSWORD] || "",
        checkInStatus: checkInStatus,
        checkInTime: row[SHEET_COLUMNS.CHECK_IN_TIME] || "",
        floor: row[SHEET_COLUMNS.FLOOR] || "",
      })
    }

    return NextResponse.json({
      reservations,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Failed to fetch reservations", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

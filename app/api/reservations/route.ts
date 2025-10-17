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

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:M",
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        reservations: [],
        today: getCurrentDateKST(),
        message: "No reservations found in the spreadsheet",
      })
    }

    const today = getCurrentDateKST()

    const reservations = rows.map((row) => {
      if (row.length < 9) {
        console.error("Row has insufficient data:", row)
      }

      const checkInDate = row[SHEET_COLUMNS.CHECK_IN_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_IN_DATE]) : ""
      const checkOutDate = row[SHEET_COLUMNS.CHECK_OUT_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_OUT_DATE]) : ""

      return {
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
        checkInStatus: row[SHEET_COLUMNS.CHECK_IN_STATUS] || "",
        checkInTime: row[SHEET_COLUMNS.CHECK_IN_TIME] || "",
        floor: row[SHEET_COLUMNS.FLOOR] || "",
      }
    })

    let filteredReservations = [...reservations]

    if (todayOnly) {
      filteredReservations = filteredReservations.filter((res) => res.checkInDate >= today)
    }

    if (guestName) {
      filteredReservations = filteredReservations.filter((res) => res.guestName === guestName)
    }

    filteredReservations = filteredReservations.filter((res) => !res.checkInStatus || res.checkInStatus.trim() === "")

    return NextResponse.json({
      reservations: filteredReservations,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Failed to fetch reservations", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

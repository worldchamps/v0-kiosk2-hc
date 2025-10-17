import { type NextRequest, NextResponse } from "next/server"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { normalizeDate } from "@/lib/date-utils"

export async function GET(request: NextRequest) {
  try {
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:M",
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({ reservations: [] })
    }

    const reservations = rows.map((row, index) => {
      if (row.length < SHEET_COLUMNS.CHECK_IN_TIME + 1) {
        console.error(`Row ${index + 2} has insufficient data (length: ${row.length})`)
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
      }
    })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const date = searchParams.get("date")
    const roomType = searchParams.get("roomType")
    const place = searchParams.get("place")

    let filteredReservations = [...reservations]

    if (status) {
      filteredReservations = filteredReservations.filter((res) => res.checkInStatus === status)
    }

    if (date) {
      filteredReservations = filteredReservations.filter((res) => {
        return res.checkInDate === date || res.checkOutDate === date
      })
    }

    if (roomType) {
      filteredReservations = filteredReservations.filter((res) => res.roomType === roomType)
    }

    if (place) {
      filteredReservations = filteredReservations.filter((res) => res.place === place)
    }

    return NextResponse.json({
      reservations: filteredReservations,
      total: filteredReservations.length,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Failed to fetch reservations", details: (error as Error).message },
      { status: 500 },
    )
  }
}

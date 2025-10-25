import { type NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { normalizeDate } from "@/lib/date-utils"

// API Key for authentication
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""
const API_KEY = process.env.API_KEY || ""

// 인증 함수 수정 - 공개 접근 허용
function authenticateAdminRequest(request: NextRequest) {
  const headersList = headers()
  const apiKey = headersList.get("x-api-key")

  // 클라이언트에서 API 키 없이 호출할 수 있도록 허용
  // 이 API는 공개적으로 접근 가능하도록 변경
  return true
}

// GET endpoint to fetch all reservations (admin only)
export async function GET(request: NextRequest) {
  try {
    // 인증 로직 수정 - 항상 접근 허용
    if (!authenticateAdminRequest(request)) {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 401 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    console.log("Fetching reservations from Google Sheets...")

    // Fetch data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:M", // Include all columns
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      console.log("No rows found in the spreadsheet")
      return NextResponse.json({ reservations: [] })
    }

    console.log(`Found ${rows.length} rows in the spreadsheet`)

    // Map the rows to reservation objects using the updated column indices
    const reservations = rows.map((row, index) => {
      // 디버깅을 위해 원본 행 데이터 로깅
      if (index < 3) {
        console.log(`Row ${index + 2}:`, row)
      }

      // 행 길이 확인
      if (row.length < SHEET_COLUMNS.CHECK_IN_TIME + 1) {
        console.warn(`Row ${index + 2} has insufficient data (length: ${row.length})`)
      }

      // 날짜 형식 정규화
      const checkInDate = row[SHEET_COLUMNS.CHECK_IN_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_IN_DATE]) : ""
      const checkOutDate = row[SHEET_COLUMNS.CHECK_OUT_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_OUT_DATE]) : ""

      // 디버깅을 위한 로그
      if (index < 3) {
        console.log(
          `Row ${index + 2} dates - Original: "${row[SHEET_COLUMNS.CHECK_IN_DATE]}", Normalized: "${checkInDate}"`,
        )
      }

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
        // 디버깅용 정보
        _originalCheckInDate: row[SHEET_COLUMNS.CHECK_IN_DATE] || "",
        _normalizedCheckInDate: checkInDate,
      }
    })

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const date = searchParams.get("date")
    const roomType = searchParams.get("roomType")
    const place = searchParams.get("place")

    let filteredReservations = [...reservations]

    // Apply filters if provided
    if (status) {
      filteredReservations = filteredReservations.filter((res) => res.checkInStatus === status)
    }

    if (date) {
      console.log(`Filtering by date: "${date}"`)
      filteredReservations = filteredReservations.filter((res, index) => {
        const match = res.checkInDate === date || res.checkOutDate === date
        if (index < 10) {
          console.log(
            `Reservation date check - checkInDate: "${res.checkInDate}", checkOutDate: "${res.checkOutDate}", filterDate: "${date}", match: ${match}`,
          )
        }
        return match
      })
    }

    if (roomType) {
      filteredReservations = filteredReservations.filter((res) => res.roomType === roomType)
    }

    if (place) {
      filteredReservations = filteredReservations.filter((res) => res.place === place)
    }

    console.log(`Returning ${filteredReservations.length} reservations after filtering`)

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

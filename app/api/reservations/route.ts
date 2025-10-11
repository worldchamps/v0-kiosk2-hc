import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { getCurrentDateKST, normalizeDate } from "@/lib/date-utils"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

// Update the authentication function to handle different access levels
function authenticateRequest(request: NextRequest, requiredLevel: "public" | "admin" = "public") {
  const headersList = headers()
  const apiKey = headersList.get("x-api-key")

  // 클라이언트에서 API 키 없이 호출할 수 있도록 허용
  // 이 API는 공개적으로 접근 가능하지만, 서버 측에서 요청을 검증합니다
  if (requiredLevel === "public") {
    if (!apiKey) return true
    return apiKey === API_KEY || apiKey === ADMIN_API_KEY
  }

  // For admin operations, require the admin key
  if (!apiKey) return false
  return apiKey === ADMIN_API_KEY
}

// GET endpoint to fetch reservations
export async function GET(request: NextRequest) {
  try {
    // Public operation - allow with public key
    if (!authenticateRequest(request, "public")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const guestName = searchParams.get("name")
    const todayOnly = searchParams.get("todayOnly") === "true" // 기본값은 false로 변경

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // Fetch data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:M", // Updated range to include all columns
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        reservations: [],
        today: getCurrentDateKST(),
        message: "No reservations found in the spreadsheet",
      })
    }

    // 현재 날짜(KST)
    const today = getCurrentDateKST()

    // 예약 정보에 층수 정보 추가
    // Map the rows to reservation objects using the updated column indices
    const reservations = rows.map((row) => {
      // 일부 행에 데이터가 부족할 경우 처리
      if (row.length < 9) {
        console.warn("Row has insufficient data:", row)
      }

      // 날짜 형식 정규화
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
        floor: row[SHEET_COLUMNS.FLOOR] || "", // 층수 정보 추가
        // 디버깅용 정보
        _originalCheckInDate: row[SHEET_COLUMNS.CHECK_IN_DATE] || "",
        _normalizedCheckInDate: checkInDate,
        _isToday: checkInDate === today,
      }
    })

    let filteredReservations = [...reservations]

    // 오늘 날짜(KST 기준)로 필터링 - 오늘 이후 날짜 포함
    if (todayOnly) {
      filteredReservations = filteredReservations.filter((res) => res.checkInDate >= today)
    }

    // 이름으로 필터링
    if (guestName) {
      filteredReservations = filteredReservations.filter((res) => res.guestName === guestName)
    }

    // 체크인 전 예약만 반환 (체크인 상태가 비어있는 경우)
    // 이 부분은 문제가 될 수 있으므로 일단 주석 처리
    // filteredReservations = filteredReservations.filter((res) => !res.checkInStatus)

    // 디버깅 정보 추가
    const debugInfo = {
      today,
      totalReservations: reservations.length,
      filteredCount: filteredReservations.length,
      filterCriteria: {
        guestName,
        todayOnly,
      },
      // 날짜 형식 디버깅
      dateFormats: reservations.slice(0, 5).map((res) => ({
        guestName: res.guestName,
        originalCheckInDate: res._originalCheckInDate,
        normalizedCheckInDate: res._normalizedCheckInDate,
        isToday: res._isToday,
      })),
    }

    return NextResponse.json({
      reservations: filteredReservations,
      debug: debugInfo,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Failed to fetch reservations", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

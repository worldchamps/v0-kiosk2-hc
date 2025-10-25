import { type NextRequest, NextResponse } from "next/server"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name")
    const reservationIdSuffix = searchParams.get("reservationIdSuffix")

    if (!name && !reservationIdSuffix) {
      return NextResponse.json({ success: false, error: "예약자명 또는 예약번호를 입력해주세요." }, { status: 400 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ success: false, error: "스프레드시트 ID가 설정되지 않았습니다." }, { status: 500 })
    }

    // Reservations 시트에서 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A:N", // A열부터 N열까지
    })

    const rows = response.data.values
    if (!rows || rows.length <= 1) {
      return NextResponse.json({
        success: false,
        error: "예약 데이터가 없습니다.",
      })
    }

    // 헤더 행 제외하고 데이터 행만 처리
    const dataRows = rows.slice(1)
    const matchingReservations = []

    for (const row of dataRows) {
      let isMatch = false

      if (name) {
        // 이름으로 검색
        const guestName = row[SHEET_COLUMNS.GUEST_NAME] || ""
        if (guestName.toLowerCase().includes(name.toLowerCase())) {
          isMatch = true
        }
      }

      if (reservationIdSuffix) {
        // 예약 ID 뒷자리 6자리로 검색
        const reservationId = row[SHEET_COLUMNS.RESERVATION_ID] || ""
        if (reservationId.length >= 6) {
          const lastSixChars = reservationId.slice(-6)
          if (lastSixChars.toLowerCase() === reservationIdSuffix.toLowerCase()) {
            isMatch = true
          }
        }
      }

      if (isMatch) {
        const reservation = {
          place: row[SHEET_COLUMNS.PLACE] || "",
          guestName: row[SHEET_COLUMNS.GUEST_NAME] || "",
          reservationId: row[SHEET_COLUMNS.RESERVATION_ID] || "",
          bookingPlatform: row[SHEET_COLUMNS.BOOKING_PLATFORM] || "",
          roomType: row[SHEET_COLUMNS.ROOM_TYPE] || "",
          price: row[SHEET_COLUMNS.PRICE] || "",
          phoneNumber: row[SHEET_COLUMNS.PHONE_NUMBER] || "",
          checkInDate: row[SHEET_COLUMNS.CHECK_IN_DATE] || "",
          checkOutDate: row[SHEET_COLUMNS.CHECK_OUT_DATE] || "",
          roomNumber: row[SHEET_COLUMNS.ROOM_NUMBER] || "",
          password: row[SHEET_COLUMNS.PASSWORD] || "",
          checkInStatus: row[SHEET_COLUMNS.CHECK_IN_STATUS] || "",
          checkInTime: row[SHEET_COLUMNS.CHECK_IN_TIME] || "",
          floor: row[SHEET_COLUMNS.FLOOR] || "",
        }

        matchingReservations.push(reservation)
      }
    }

    if (matchingReservations.length === 0) {
      return NextResponse.json({
        success: false,
        error: "일치하는 예약을 찾을 수 없습니다.",
      })
    }

    return NextResponse.json({
      success: true,
      reservations: matchingReservations,
    })
  } catch (error) {
    console.error("예약 검색 오류:", error)
    return NextResponse.json({ success: false, error: "예약 검색 중 오류가 발생했습니다." }, { status: 500 })
  }
}

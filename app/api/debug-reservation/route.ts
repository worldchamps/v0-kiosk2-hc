import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { getCurrentDateKST, normalizeDate } from "@/lib/date-utils"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const guestName = searchParams.get("name")

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // 스프레드시트 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A1:M", // 헤더 포함
    })

    const rows = response.data.values || []

    // 헤더와 데이터 분리
    const headers = rows.length > 0 ? rows[0] : []
    const dataRows = rows.slice(1)

    // 현재 날짜(KST)
    const today = getCurrentDateKST()

    // 디버깅 정보 (민감한 변수 제외)
    const debugInfo = {
      today,
      headers,
      totalRows: dataRows.length,
      sheetColumns: SHEET_COLUMNS,
      environment: {
        clientEmailExists: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        privateKeyExists: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
        spreadsheetIdExists: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
        apiKeyExists: !!process.env.API_KEY,
      },
    }

    // 이름으로 필터링
    let filteredRows = dataRows
    if (guestName) {
      filteredRows = dataRows.filter((row) => row[SHEET_COLUMNS.GUEST_NAME] === guestName)

      // 필터링된 예약 정보 추가
      debugInfo.filteredByName = {
        name: guestName,
        count: filteredRows.length,
        rows: filteredRows.map((row) => {
          const originalCheckInDate = row[SHEET_COLUMNS.CHECK_IN_DATE] || ""
          const normalizedCheckInDate = normalizeDate(originalCheckInDate)

          return {
            place: row[SHEET_COLUMNS.PLACE] || "",
            guestName: row[SHEET_COLUMNS.GUEST_NAME] || "",
            reservationId: row[SHEET_COLUMNS.RESERVATION_ID] || "",
            originalCheckInDate,
            normalizedCheckInDate,
            isToday: normalizedCheckInDate === today,
          }
        }),
      }
    }

    return NextResponse.json(debugInfo)
  } catch (error) {
    console.error("Error in debug API:", error)
    return NextResponse.json(
      {
        error: "Debug API error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

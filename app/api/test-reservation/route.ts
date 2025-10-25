import { NextResponse } from "next/server"
import { google } from "googleapis"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  try {
    // Google Sheets API 설정
    const privateKey = (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n")

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "",
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    })

    const sheets = google.sheets({ version: "v4", auth })
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    // URL에서 이름 파라미터 가져오기
    const { searchParams } = new URL(request.url)
    const guestName = searchParams.get("name") || "김민준" // 기본값 설정

    // 모든 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A1:K", // 헤더 포함
    })

    const rows = response.data.values || []

    // 헤더와 데이터 분리
    const headers = rows.length > 0 ? rows[0] : []
    const dataRows = rows.slice(1)

    // 이름으로 필터링
    const filteredRows = dataRows.filter((row) => row[0] === guestName)

    // 결과 반환
    return NextResponse.json({
      headers,
      allRows: dataRows.length,
      filteredRows,
      matchFound: filteredRows.length > 0,
      searchName: guestName,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "테스트 중 오류 발생",
        details: (error as Error).message,
        stack: (error as Error).stack,
      },
      { status: 500 },
    )
  }
}

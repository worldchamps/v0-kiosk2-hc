import { NextResponse } from "next/server"
import { createSheetsClient } from "@/lib/google-sheets"
import { getCurrentDateKST } from "@/lib/date-utils"

export async function GET() {
  try {
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // 스프레드시트 정보 가져오기
    const spreadsheetInfo = await sheets.spreadsheets.get({
      spreadsheetId,
    })

    // 시트 목록 가져오기
    const sheetsList = spreadsheetInfo.data.sheets?.map((sheet) => ({
      title: sheet.properties?.title,
      sheetId: sheet.properties?.sheetId,
    }))

    // Reservations 시트에서 데이터 가져오기
    const reservationsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A1:M",
    })

    const reservationsHeaders = reservationsResponse.data.values?.[0] || []
    const reservationsData = reservationsResponse.data.values?.slice(1) || []

    // 현재 날짜(KST)
    const today = getCurrentDateKST()

    // 환경 변수 확인 (민감한 변수 제외)
    const envCheck = {
      clientEmailExists: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      privateKeyExists: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
      spreadsheetIdExists: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      apiKeyExists: !!process.env.API_KEY,
      adminApiKeyExists: !!process.env.ADMIN_API_KEY,
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      today,
      spreadsheetTitle: spreadsheetInfo.data.properties?.title,
      sheets: sheetsList,
      reservations: {
        headers: reservationsHeaders,
        totalRows: reservationsData.length,
        sampleData: reservationsData.slice(0, 5), // 처음 5개 행만 표시
      },
      environment: envCheck,
    })
  } catch (error) {
    console.error("Error debugging reservations:", error)
    return NextResponse.json(
      {
        error: "Failed to debug reservations",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

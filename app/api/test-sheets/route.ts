import { NextResponse } from "next/server"
import { createSheetsClient, formatPrivateKey } from "@/lib/google-sheets"

export async function GET() {
  try {
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

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

    // 첫 번째 행 데이터 가져오기
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A1:K1",
    })

    // 모든 예약 데이터 가져오기
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:K",
    })

    // 개인 키 형식 확인 (민감한 정보는 마스킹)
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY || ""
    const privateKeyInfo = {
      length: privateKey.length,
      startsWithHeader: privateKey.startsWith("-----BEGIN PRIVATE KEY-----"),
      endsWithFooter: privateKey.endsWith("-----END PRIVATE KEY-----\n"),
      containsNewlines: privateKey.includes("\n"),
      containsEscapedNewlines: privateKey.includes("\\n"),
      formattedLength: formatPrivateKey(privateKey).length,
      formattedContainsNewlines: formatPrivateKey(privateKey).includes("\n"),
    }

    return NextResponse.json({
      success: true,
      spreadsheetTitle: spreadsheetInfo.data.properties?.title,
      sheets: sheetsList,
      headers: headerResponse.data.values?.[0] || [],
      rowCount: dataResponse.data.values?.length || 0,
      sampleData: dataResponse.data.values?.slice(0, 2) || [], // 처음 2개 행만 표시
      environment: {
        clientEmailExists: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        privateKeyExists: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
        privateKeyLength: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.length || 0,
        spreadsheetIdExists: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
        apiKeyExists: !!process.env.API_KEY,
        adminApiKeyExists: !!process.env.ADMIN_API_KEY,
      },
      privateKeyInfo,
    })
  } catch (error) {
    console.error("Error testing Google Sheets connection:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to connect to Google Sheets",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        environment: {
          clientEmailExists: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
          privateKeyExists: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
          privateKeyLength: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.length || 0,
          spreadsheetIdExists: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
          apiKeyExists: !!process.env.API_KEY,
          adminApiKeyExists: !!process.env.ADMIN_API_KEY,
        },
      },
      { status: 500 },
    )
  }
}

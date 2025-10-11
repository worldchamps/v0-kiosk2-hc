import { NextResponse } from "next/server"
import { google } from "googleapis"
import { formatPrivateKey } from "@/lib/google-sheets"

export async function GET() {
  try {
    // 환경 변수 확인
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || ""
    const privateKey = formatPrivateKey(process.env.GOOGLE_SHEETS_PRIVATE_KEY || "")
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    // 환경 변수 정보 (민감한 정보는 마스킹)
    const envInfo = {
      clientEmail: clientEmail
        ? `${clientEmail.substring(0, 5)}...${clientEmail.substring(clientEmail.length - 10)}`
        : "Not set",
      privateKeyExists: !!privateKey,
      privateKeyLength: privateKey.length,
      spreadsheetIdExists: !!spreadsheetId,
      spreadsheetId: spreadsheetId || "Not set",
    }

    // 인증 시도
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    })

    // 인증 정보 가져오기
    const authClient = await auth.getClient()
    const authInfo = {
      success: !!authClient,
      type: authClient.constructor.name,
    }

    // 스프레드시트 접근 시도
    let spreadsheetInfo = { success: false, error: null }
    try {
      const sheets = google.sheets({ version: "v4", auth })
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      })

      spreadsheetInfo = {
        success: true,
        title: response.data.properties?.title || "Unknown",
        sheets: response.data.sheets?.map((sheet) => sheet.properties?.title) || [],
      }
    } catch (error) {
      spreadsheetInfo = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      environment: envInfo,
      auth: authInfo,
      spreadsheet: spreadsheetInfo,
      message: "이 정보를 확인하여 Google Sheets API 권한 문제를 해결하세요.",
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Authentication debug error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

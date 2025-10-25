import { NextResponse } from "next/server"

export async function GET() {
  // 환경 변수 확인 (민감한 변수 제외)
  const envCheck = {
    hasClientEmail: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    hasPrivateKey: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
    hasSpreadsheetId: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    hasApiKey: !!process.env.API_KEY,
  }

  return NextResponse.json({
    message: "간단한 API 테스트",
    timestamp: new Date().toISOString(),
    environmentCheck: envCheck,
  })
}

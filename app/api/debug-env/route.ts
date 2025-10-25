import { NextResponse } from "next/server"

export async function GET() {
  try {
    // 환경 변수 확인 (민감한 정보는 마스킹)
    const envCheck = {
      clientEmail: {
        exists: !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        value: process.env.GOOGLE_SHEETS_CLIENT_EMAIL
          ? `${process.env.GOOGLE_SHEETS_CLIENT_EMAIL.substring(0, 5)}...${process.env.GOOGLE_SHEETS_CLIENT_EMAIL.substring(process.env.GOOGLE_SHEETS_CLIENT_EMAIL.length - 10)}`
          : null,
      },
      privateKey: {
        exists: !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
        length: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.length || 0,
        startsWithHeader: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.startsWith("-----BEGIN PRIVATE KEY-----"),
        endsWithFooter: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.endsWith("-----END PRIVATE KEY-----\n"),
        containsNewlines: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.includes("\n"),
        containsEscapedNewlines: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.includes("\\n"),
      },
      spreadsheetId: {
        exists: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
        value: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
      },
      apiKey: {
        exists: !!process.env.API_KEY,
        length: process.env.API_KEY?.length || 0,
      },
      adminApiKey: {
        exists: !!process.env.ADMIN_API_KEY,
        length: process.env.ADMIN_API_KEY?.length || 0,
      },
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      environmentVariables: envCheck,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Error checking environment variables",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

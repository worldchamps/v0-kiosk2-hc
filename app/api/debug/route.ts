import { NextResponse } from "next/server"
import { google } from "googleapis"

export async function GET() {
  try {
    // 환경 변수 확인
    const envVars = {
      clientEmail: process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "(not set)",
      privateKeyLength: process.env.GOOGLE_SHEETS_PRIVATE_KEY ? process.env.GOOGLE_SHEETS_PRIVATE_KEY.length : 0,
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "(not set)",
      apiKey: process.env.API_KEY ? "설정됨 (문자열 길이: " + process.env.API_KEY.length + ")" : "(not set)",
    }

    // 개인 키 형식 확인
    let privateKeyFormatted = false
    if (process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
      privateKeyFormatted =
        process.env.GOOGLE_SHEETS_PRIVATE_KEY.includes("-----BEGIN PRIVATE KEY-----") &&
        process.env.GOOGLE_SHEETS_PRIVATE_KEY.includes("-----END PRIVATE KEY-----")
    }

    // Google Sheets API 연결 테스트
    let sheetsConnection = { success: false, message: "Not attempted" }

    try {
      // 개인 키 형식 수정 (줄바꿈 문자 처리)
      const privateKey = (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n")

      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "",
          private_key: privateKey,
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      })

      const sheets = google.sheets({ version: "v4", auth })

      if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
        // 스프레드시트 정보 가져오기 시도
        const spreadsheetInfo = await sheets.spreadsheets.get({
          spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
        })

        sheetsConnection = {
          success: true,
          message: "Successfully connected to spreadsheet",
          title: spreadsheetInfo.data.properties?.title,
          sheets: spreadsheetInfo.data.sheets?.map((sheet) => sheet.properties?.title) || [],
        }

        // 시트 데이터 가져오기 시도
        try {
          const dataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
            range: "Reservations!A1:B2",
          })

          sheetsConnection.dataTest = {
            success: true,
            values: dataResponse.data.values,
            hasReservationsSheet: dataResponse.data.values ? true : false,
          }
        } catch (dataError) {
          sheetsConnection.dataTest = {
            success: false,
            error: (dataError as Error).message,
            possibleCause: "Reservations sheet might not exist or has incorrect permissions",
          }
        }
      }
    } catch (sheetsError) {
      sheetsConnection = {
        success: false,
        message: "Failed to connect to Google Sheets",
        error: (sheetsError as Error).message,
        stack: (sheetsError as Error).stack,
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      environmentVariables: envVars,
      privateKeyFormatted,
      googleSheetsConnection: sheetsConnection,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Server error during debugging",
        details: (error as Error).message,
        stack: (error as Error).stack,
      },
      { status: 500 },
    )
  }
}

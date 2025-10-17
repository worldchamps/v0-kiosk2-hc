import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient, PMS_QUEUE_COLUMNS } from "@/lib/google-sheets"

const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

function authenticateRequest(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization")
  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

// POST: 체크인 처리 완료 표시
export async function POST(request: NextRequest) {
  try {
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // PMS Queue 시트에서 해당 ID 찾기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "PMS Queue!A2:G",
    })

    const rows = response.data.values || []
    let rowIndex = -1

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][PMS_QUEUE_COLUMNS.ID] === id) {
        rowIndex = i + 2 // +2 because we start at A2
        break
      }
    }

    if (rowIndex === -1) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 })
    }

    const completedAt = new Date().toISOString()

    // 상태를 completed로 변경
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `PMS Queue!E${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["completed"]],
      },
    })

    // 완료 시간 기록
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `PMS Queue!G${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[completedAt]],
      },
    })

    return NextResponse.json({
      success: true,
      message: "Queue item marked as completed",
      data: {
        id,
        completedAt,
      },
    })
  } catch (error) {
    console.error("Error completing PMS queue item:", error)
    return NextResponse.json(
      { error: "Failed to complete queue item", details: (error as Error).message },
      { status: 500 },
    )
  }
}

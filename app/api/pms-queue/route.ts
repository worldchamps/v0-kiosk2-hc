import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient, PMS_QUEUE_COLUMNS } from "@/lib/google-sheets"

const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

function authenticateRequest(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization")
  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

// GET: 대기 중인 체크인 목록 조회 (로컬 PMS가 폴링)
export async function GET(request: NextRequest) {
  try {
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // PMS Queue 시트에서 모든 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "PMS Queue!A2:G", // 헤더 제외
    })

    const rows = response.data.values || []

    // pending 상태인 항목만 필터링
    const pendingCheckins = rows
      .filter((row) => row[PMS_QUEUE_COLUMNS.STATUS] === "pending")
      .map((row) => ({
        id: row[PMS_QUEUE_COLUMNS.ID] || "",
        roomNumber: row[PMS_QUEUE_COLUMNS.ROOM_NUMBER] || "",
        guestName: row[PMS_QUEUE_COLUMNS.GUEST_NAME] || "",
        checkInDate: row[PMS_QUEUE_COLUMNS.CHECK_IN_DATE] || "",
        status: row[PMS_QUEUE_COLUMNS.STATUS] || "",
        createdAt: row[PMS_QUEUE_COLUMNS.CREATED_AT] || "",
      }))

    return NextResponse.json({
      success: true,
      data: pendingCheckins,
      count: pendingCheckins.length,
    })
  } catch (error) {
    console.error("Error fetching PMS queue:", error)
    return NextResponse.json({ error: "Failed to fetch PMS queue", details: (error as Error).message }, { status: 500 })
  }
}

// POST: 새 체크인을 큐에 추가
export async function POST(request: NextRequest) {
  try {
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { roomNumber, guestName, checkInDate } = body

    if (!roomNumber || !guestName) {
      return NextResponse.json({ error: "Room number and guest name are required" }, { status: 400 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // 고유 ID 생성 (타임스탬프 기반)
    const id = `PMS-${Date.now()}`
    const createdAt = new Date().toISOString()

    // PMS Queue 시트에 새 행 추가
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "PMS Queue!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[id, roomNumber, guestName, checkInDate || createdAt, "pending", createdAt, ""]],
      },
    })

    return NextResponse.json({
      success: true,
      message: "Added to PMS queue",
      data: {
        id,
        roomNumber,
        guestName,
        checkInDate: checkInDate || createdAt,
        status: "pending",
        createdAt,
      },
    })
  } catch (error) {
    console.error("Error adding to PMS queue:", error)
    return NextResponse.json(
      { error: "Failed to add to PMS queue", details: (error as Error).message },
      { status: 500 },
    )
  }
}

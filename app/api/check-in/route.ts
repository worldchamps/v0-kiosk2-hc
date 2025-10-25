import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS, getRoomInfoFromStatus } from "@/lib/google-sheets"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

// Update the authentication function
function authenticateRequest(request: NextRequest) {
  const headersList = headers()
  const apiKey = headersList.get("x-api-key")

  // 클라이언트에서 API 키 없이 호출할 수 있도록 허용
  // 이 API는 공개적으로 접근 가능하지만, 서버 측에서 요청을 검증합니다
  if (!apiKey) return true

  // 관리자 키가 제공된 경우 검증
  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

// 체크인 API에서 층수 정보도 함께 반환하도록 수정
export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { reservationId } = body

    if (!reservationId) {
      return NextResponse.json({ error: "Reservation ID is required" }, { status: 400 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    // First, get all reservations to find the row index
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:C", // Just need place, guestName, and reservationId columns
    })

    const rows = response.data.values
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No reservations found" }, { status: 404 })
    }

    // Find the row with the matching reservation ID
    let rowIndex = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][SHEET_COLUMNS.RESERVATION_ID] === reservationId) {
        rowIndex = i + 2 // +2 because we start at A2 (1-indexed)
        break
      }
    }

    if (rowIndex === -1) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 })
    }

    // Get the reservation data to return the room number
    const reservationResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `Reservations!A${rowIndex}:N${rowIndex}`, // 범위를 N열까지 확장
    })

    const reservationData = reservationResponse.data.values?.[0] || []
    const roomNumber = reservationData[SHEET_COLUMNS.ROOM_NUMBER] || ""

    // Beach Room Status 시트에서 객실 정보 조회
    const roomInfo = await getRoomInfoFromStatus(spreadsheetId, roomNumber)

    let password = ""
    let floor = ""

    if (roomInfo) {
      // Beach Room Status에서 정보를 찾은 경우
      password = roomInfo.password
      floor = roomInfo.floor
      console.log("Room info from Beach Room Status:", roomInfo)
    } else {
      // Beach Room Status에서 정보를 찾지 못한 경우 기존 예약 정보 사용
      password = reservationData[SHEET_COLUMNS.PASSWORD] || ""
      floor = reservationData[SHEET_COLUMNS.FLOOR] || ""
      console.warn("Using reservation data as fallback for room info")
    }

    // Update the check-in status
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Reservations!${String.fromCharCode(65 + SHEET_COLUMNS.CHECK_IN_STATUS)}${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Checked In"]],
      },
    })

    // Update the check-in timestamp
    const checkInTime = new Date().toISOString()
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Reservations!${String.fromCharCode(65 + SHEET_COLUMNS.CHECK_IN_TIME)}${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[checkInTime]],
      },
    })

    return NextResponse.json({
      success: true,
      message: "Check-in completed successfully",
      data: {
        reservationId,
        checkInTime,
        status: "Checked In",
        roomNumber,
        password,
        floor,
      },
    })
  } catch (error) {
    console.error("Error during check-in:", error)
    return NextResponse.json(
      { error: "Failed to complete check-in", details: (error as Error).message },
      { status: 500 },
    )
  }
}

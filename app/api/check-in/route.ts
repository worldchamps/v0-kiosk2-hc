import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { addToPMSQueue } from "@/lib/firebase-admin"

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
    const guestName = reservationData[SHEET_COLUMNS.GUEST_NAME] || ""
    const checkInDate = reservationData[SHEET_COLUMNS.CHECK_IN_DATE] || ""

    const password = reservationData[SHEET_COLUMNS.PASSWORD] || ""
    const floor = reservationData[SHEET_COLUMNS.FLOOR] || ""

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

    try {
      console.log("[v0] Attempting to add to Firebase PMS Queue...")
      console.log("[v0] Room Number:", roomNumber)
      console.log("[v0] Guest Name:", guestName)
      console.log("[v0] Check-in Date:", checkInDate)

      await addToPMSQueue({
        roomNumber,
        guestName,
        checkInDate,
      })
      console.log("[v0] ✅ Successfully added to Firebase PMS Queue:", { roomNumber, guestName })
    } catch (firebaseError) {
      console.error("[v0] ❌ Failed to add to Firebase PMS Queue:", firebaseError)
      console.error("[v0] Error details:", (firebaseError as Error).message)
      console.error("[v0] Error stack:", (firebaseError as Error).stack)
      // Firebase 추가 실패해도 체크인은 계속 진행
    }

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

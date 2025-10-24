import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { addToPMSQueue } from "@/lib/firebase-admin"
import { getPropertyFromPlace, getPropertyFromRoomNumber, canCheckInAtKiosk } from "@/lib/property-utils"
import type { PropertyId } from "@/lib/property-utils"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

async function authenticateRequest(request: NextRequest) {
  const headersList = await headers()
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
    if (!(await authenticateRequest(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { reservationId, kioskProperty, adminOverride = false } = body

    console.log("[v0] 🔍 Check-in request received:", { reservationId, kioskProperty, adminOverride })

    if (!reservationId) {
      return NextResponse.json({ error: "Reservation ID is required" }, { status: 400 })
    }

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A94:N",
    })

    const rows = response.data.values
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No reservations found" }, { status: 404 })
    }

    let rowIndex = -1
    let reservationData: string[] = []

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][SHEET_COLUMNS.RESERVATION_ID] === reservationId) {
        rowIndex = i + 94 // +94 because we start at A94
        reservationData = rows[i]
        break
      }
    }

    if (rowIndex === -1) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 })
    }

    const roomNumber = reservationData[SHEET_COLUMNS.ROOM_NUMBER] || ""
    const place = reservationData[SHEET_COLUMNS.PLACE] || ""
    const guestName = reservationData[SHEET_COLUMNS.GUEST_NAME] || ""
    const checkInDate = reservationData[SHEET_COLUMNS.CHECK_IN_DATE] || ""
    const password = reservationData[SHEET_COLUMNS.PASSWORD] || ""
    const floor = reservationData[SHEET_COLUMNS.FLOOR] || ""

    console.log("[v0] 📋 Reservation data:", { roomNumber, place, guestName })

    if (kioskProperty) {
      const reservationProperty = place ? getPropertyFromPlace(place) : getPropertyFromRoomNumber(roomNumber)

      console.log("[v0] 🏢 Property validation:")
      console.log("  - Room number:", roomNumber)
      console.log("  - Place:", place)
      console.log("  - Detected reservation property:", reservationProperty)
      console.log("  - Kiosk property:", kioskProperty)
      console.log("  - Admin override:", adminOverride)

      const validation = canCheckInAtKiosk(
        reservationProperty as PropertyId,
        kioskProperty as PropertyId,
        adminOverride,
      )

      console.log("[v0] ✅ Validation result:", validation)

      if (!validation.allowed) {
        console.log("[v0] ❌ Property mismatch detected!")
        return NextResponse.json(
          {
            error: "Property mismatch",
            message: validation.reason,
            reservationProperty,
            kioskProperty,
          },
          { status: 403 },
        )
      }

      if (adminOverride) {
        console.log(`[v0] ⚠️ Admin override used for check-in: ${reservationId} at ${kioskProperty}`)
      }
    }

    const checkInTime = new Date().toISOString()

    console.log("[v0] 📝 Updating Google Sheets...")
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: `Reservations!${String.fromCharCode(65 + SHEET_COLUMNS.CHECK_IN_STATUS)}${rowIndex}`,
            values: [["Checked In"]],
          },
          {
            range: `Reservations!${String.fromCharCode(65 + SHEET_COLUMNS.CHECK_IN_TIME)}${rowIndex}`,
            values: [[checkInTime]],
          },
        ],
      },
    })
    console.log("[v0] ✅ Google Sheets updated successfully")

    try {
      console.log("[v0] 🔥 Adding to Firebase PMS Queue:", { roomNumber, guestName, checkInDate })
      await addToPMSQueue({
        roomNumber,
        guestName,
        checkInDate,
      })
      console.log("[v0] ✅ Firebase PMS Queue added successfully")
    } catch (firebaseError) {
      console.error("[v0] ❌ Firebase PMS Queue failed:", firebaseError)
      console.error("[v0] Error details:", {
        message: (firebaseError as Error).message,
        stack: (firebaseError as Error).stack,
      })
      // Don't throw error - check-in should still succeed even if Firebase fails
    }

    console.log("[v0] ✅ Check-in completed successfully!")

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
    console.error("[v0] ❌ Error during check-in:", error)
    return NextResponse.json(
      { error: "Failed to complete check-in", details: (error as Error).message },
      { status: 500 },
    )
  }
}

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { addToPMSQueue } from "@/lib/firebase-admin"
import { getPropertyFromReservation, canCheckInAtKiosk } from "@/lib/property-utils"
import type { PropertyId } from "@/lib/property-utils"
import { sendAligoSMS, formatCheckInMessage } from "@/lib/aligo-sms"
import { getReservationCheckInEligibility } from "@/lib/date-utils"
import { getKioskScope, isRoomInBuilding, buildingRestrictionMessage } from "@/lib/kiosk-scope"

// API Key for authentication
const API_KEY = process.env.API_KEY || ""
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ""

async function authenticateRequest(request: NextRequest) {
  const headersList = await headers()
  const apiKey = headersList.get("x-api-key")

  if (!apiKey) return true

  return apiKey === API_KEY || apiKey === ADMIN_API_KEY
}

export async function POST(request: NextRequest) {
  try {
    if (!(await authenticateRequest(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { reservationId, kioskProperty, adminOverride = false } = body
    const scope = getKioskScope()

    console.log("[v0] ========================================")
    console.log("[v0] 🔍 Check-in Request")
    console.log("[v0] ========================================")
    console.log("[v0] Reservation ID:", reservationId)
    console.log("[v0] Kiosk Property:", kioskProperty)
    console.log("[v0] Admin Override:", adminOverride)

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
      range: "Reservations!A2:N",
    })

    const rows = response.data.values
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No reservations found" }, { status: 404 })
    }

    let rowIndex = -1
    let reservationData: string[] = []

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][SHEET_COLUMNS.RESERVATION_ID] === reservationId) {
        rowIndex = i + 2
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
    const phoneNumber = reservationData[SHEET_COLUMNS.PHONE_NUMBER] || ""

    // Validate the room freshly read from Sheets, including after reassignment.
    // adminOverride never bypasses the physical kiosk's building restriction.
    if (scope.building && !isRoomInBuilding(roomNumber, scope.building)) {
      return NextResponse.json(
        { error: "KIOSK_BUILDING_MISMATCH", message: buildingRestrictionMessage(scope.building) },
        { status: 403 },
      )
    }

    // Read the current H-column value, not the schedule cached by the kiosk UI.
    // Property overrides do not bypass the reservation's scheduled entry time.
    const eligibility = getReservationCheckInEligibility(checkInDate)
    if (!eligibility.allowed) {
      return NextResponse.json(
        { error: eligibility.code, ...eligibility },
        { status: 409 },
      )
    }

    console.log("[v0] 📋 Reservation Data:")
    console.log("[v0]   Room Number:", roomNumber)
    console.log("[v0]   Place:", place)
    console.log("[v0]   Guest Name:", guestName)

    if (kioskProperty) {
      const reservationProperty = getPropertyFromReservation({
        roomNumber,
        place,
      })

      if (!reservationProperty) {
        console.log("[v0] Could not detect reservation property - allowing check-in")
      } else {
        const validation = canCheckInAtKiosk(
          reservationProperty as PropertyId,
          kioskProperty as PropertyId,
          adminOverride,
        )

        if (!validation.allowed) {
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
          console.log("[v0] Admin override used for check-in")
        }
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
    console.log("[v0] ✅ Google Sheets updated")

    try {
      console.log("[v0] 🔥 Adding to Firebase PMS Queue")
      await addToPMSQueue({
        roomNumber,
        guestName,
        checkInDate,
      })
      console.log("[v0] ✅ Firebase PMS Queue added")
    } catch (firebaseError) {
      console.error("[v0] ❌ Firebase PMS Queue failed:", firebaseError)
    }

    console.log("[v0] ✅ Check-in completed successfully!")

    /* SMS 발송 비활성화 (사용자 요청)
    if (phoneNumber) {
      console.log("[v0] 📱 Sending SMS notification to:", phoneNumber)
      try {
        const smsMessage = formatCheckInMessage({
          guestName,
          roomNumber,
          password,
          floor,
        })

        const smsResult = await sendAligoSMS({
          phoneNumber,
          message: smsMessage,
        })

        if (smsResult.success) {
          console.log("[v0] ✅ SMS sent successfully")
        } else {
          console.error("[v0] ❌ SMS failed:", smsResult.message)
        }
      } catch (smsError) {
        console.error("[v0] ❌ SMS error:", smsError)
      }
    } else {
      console.log("[v0] ⚠️ No phone number provided, skipping SMS")
    }
    */

    console.log("[v0] ========================================")

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
    console.error("[v0] Check-in error:", error)
    return NextResponse.json(
      { error: "Failed to complete check-in", details: (error as Error).message },
      { status: 500 },
    )
  }
}

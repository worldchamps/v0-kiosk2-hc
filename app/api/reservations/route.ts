import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { getCurrentDateKST, normalizeDate } from "@/lib/date-utils"
import { getPropertyFromReservation } from "@/lib/property-utils"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const guestName = searchParams.get("name")
    const todayOnly = searchParams.get("todayOnly") === "true"
    const kioskProperty = searchParams.get("kioskProperty")
    const searchAllProperties = searchParams.get("searchAll") === "true"

    console.log("[v0] Reservations API called with kioskProperty:", kioskProperty, "searchAll:", searchAllProperties)

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A94:N",
    })

    const rows = response.data.values

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        reservations: [],
        today: getCurrentDateKST(),
        message: "No reservations found in the spreadsheet",
      })
    }

    const reservations = []
    const today = getCurrentDateKST()

    for (const row of rows) {
      const rowGuestName = row[SHEET_COLUMNS.GUEST_NAME] || ""
      const checkInStatus = row[SHEET_COLUMNS.CHECK_IN_STATUS] || ""

      // Filter 1: skip if already checked in (no date normalization needed)
      if (checkInStatus && checkInStatus.trim() !== "") {
        continue
      }

      // Filter 2: if searching by name, only include matching names (no date normalization needed)
      if (guestName && rowGuestName !== guestName) {
        continue
      }

      const checkInDate = row[SHEET_COLUMNS.CHECK_IN_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_IN_DATE]) : ""
      const checkOutDate = row[SHEET_COLUMNS.CHECK_OUT_DATE] ? normalizeDate(row[SHEET_COLUMNS.CHECK_OUT_DATE]) : ""

      // Filter 3: if todayOnly, skip if check-in date is before today
      if (todayOnly && checkInDate < today) {
        continue
      }

      if (kioskProperty && !searchAllProperties) {
        const place = row[SHEET_COLUMNS.PLACE] || ""
        const roomNumber = row[SHEET_COLUMNS.ROOM_NUMBER] || ""

        console.log("[v0] Checking reservation:", {
          guestName: rowGuestName,
          place,
          roomNumber,
          kioskProperty,
        })

        const reservationProperty = getPropertyFromReservation({
          place,
          roomNumber,
        } as any)

        // If still no property detected, skip this reservation
        if (!reservationProperty) {
          console.log("[v0] Could not detect property for reservation, skipping")
          continue
        }

        console.log("[v0] Detected property:", reservationProperty, "Expected:", kioskProperty)

        // Skip if property doesn't match
        if (reservationProperty !== kioskProperty) {
          console.log("[v0] Skipping reservation - property mismatch")
          continue
        }

        console.log("[v0] Including reservation - property match!")
      }

      const place = row[SHEET_COLUMNS.PLACE] || ""
      const roomNumber = row[SHEET_COLUMNS.ROOM_NUMBER] || ""
      const detectedProperty = getPropertyFromReservation({
        place,
        roomNumber,
      } as any)

      reservations.push({
        place: place,
        guestName: rowGuestName,
        reservationId: row[SHEET_COLUMNS.RESERVATION_ID] || "",
        bookingPlatform: row[SHEET_COLUMNS.BOOKING_PLATFORM] || "",
        roomType: row[SHEET_COLUMNS.ROOM_TYPE] || "",
        price: row[SHEET_COLUMNS.PRICE] || "",
        phoneNumber: row[SHEET_COLUMNS.PHONE_NUMBER] || "",
        checkInDate: checkInDate,
        checkOutDate: checkOutDate,
        roomNumber: roomNumber,
        password: row[SHEET_COLUMNS.PASSWORD] || "",
        checkInStatus: checkInStatus,
        checkInTime: row[SHEET_COLUMNS.CHECK_IN_TIME] || "",
        floor: row[SHEET_COLUMNS.FLOOR] || "",
        property: detectedProperty,
      })
    }

    console.log("[v0] Total reservations found:", reservations.length)

    return NextResponse.json({
      reservations,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Failed to fetch reservations", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

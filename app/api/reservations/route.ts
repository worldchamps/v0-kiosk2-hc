import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { getCurrentDateKST, normalizeDate, resolveReservationSheetDateTime } from "@/lib/date-utils"
import { getPropertyFromReservation } from "@/lib/property-utils"
import { type KioskScope, getKioskScope, isRoomInBuilding, kioskForReservation } from "@/lib/kiosk-scope"

const normalizeGuestName = (value: unknown) => {
  const name = String(value ?? "").normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
  return /^[가-힣\s]+$/.test(name) ? name.replace(/\s/g, "") : name
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const guestName = searchParams.get("name")
    const normalizedGuestName = guestName === null ? null : normalizeGuestName(guestName)
    if (normalizedGuestName === "") return NextResponse.json({ reservations: [] })
    const reservationId = searchParams.get("reservationId")
    const todayOnly = searchParams.get("todayOnly") === "true"
    // Device identity comes from this PC's settings, never from the request.
    const scope = getKioskScope()

    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ""

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservations!A2:N",
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
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
    // Kiosks holding this guest's current or upcoming stays. Only the destination
    // is returned; other kiosks' reservation details never leave this server.
    const elsewhere = new Map<string, { target: KioskScope | null; near: boolean }>()

    for (const row of rows) {
      const rowGuestName = row[SHEET_COLUMNS.GUEST_NAME] || ""
      const rowReservationId = row[SHEET_COLUMNS.RESERVATION_ID] || ""
      const checkInStatus = row[SHEET_COLUMNS.CHECK_IN_STATUS] || ""

      // Filter 1: if searching by name, only include matching names (no date normalization needed)
      if (normalizedGuestName !== null && normalizeGuestName(rowGuestName) !== normalizedGuestName) {
        continue
      }

      if (reservationId && rowReservationId !== reservationId) {
        continue
      }

      const checkInDateTime = resolveReservationSheetDateTime(
        row[SHEET_COLUMNS.CHECK_IN_DATE],
        "15:00",
      )
      const checkOutDateTime = resolveReservationSheetDateTime(
        row[SHEET_COLUMNS.CHECK_OUT_DATE],
        "11:00",
      )
      const checkInDate = normalizeDate(checkInDateTime)
      const checkOutDate = normalizeDate(checkOutDateTime)

      // Filter 2: skip if already processed. A same-name guest still staying
      // (e.g. back for the door code) means any guidance could be someone else's.
      if (checkInStatus && checkInStatus.trim() !== "") {
        // Same normalization as the PMS sheet fixer: "Checked-in", "checked in", ...
        const checkedIn = checkInStatus.toLowerCase().replace(/[-_\s]+/g, " ").trim() === "checked in"
        if (checkedIn && !(checkOutDate && checkOutDate < today)) {
          elsewhere.set("unknown", { target: null, near: false })
        }
        continue
      }

      // Filter 3: if todayOnly, skip if check-in date is before today
      if (todayOnly && checkInDate < today) {
        continue
      }

      const place = row[SHEET_COLUMNS.PLACE] || ""
      const roomNumber = row[SHEET_COLUMNS.ROOM_NUMBER] || ""
      const detectedProperty = getPropertyFromReservation({ place, roomNumber })

      // Filter 4: this kiosk's building and property only
      if (!isRoomInBuilding(roomNumber, scope.building) || detectedProperty !== scope.property) {
        // Later stays and unreadable dates only make the answer ambiguous; a
        // destination needs a stay starting by tomorrow (guest a day early).
        const readable = !!checkInDate && !!checkOutDate
        if (!readable || today <= checkOutDate) {
          const target = readable ? kioskForReservation(detectedProperty, roomNumber) : null
          const key = target ? `${target.property}:${target.building}` : "unknown"
          elsewhere.set(key, { target, near: checkInDate <= tomorrow || !!elsewhere.get(key)?.near })
        }
        continue
      }

      reservations.push({
        place: place,
        guestName: rowGuestName,
        reservationId: rowReservationId,
        bookingPlatform: row[SHEET_COLUMNS.BOOKING_PLATFORM] || "",
        roomType: row[SHEET_COLUMNS.ROOM_TYPE] || "",
        price: row[SHEET_COLUMNS.PRICE] || "",
        phoneNumber: row[SHEET_COLUMNS.PHONE_NUMBER] || "",
        checkInDate: checkInDate,
        checkOutDate: checkOutDate,
        checkInDateTime,
        checkOutDateTime,
        roomNumber: roomNumber,
        // The check-in API releases the password only after validating entry time.
        password: "",
        checkInStatus: checkInStatus,
        checkInTime: row[SHEET_COLUMNS.CHECK_IN_TIME] || "",
        floor: row[SHEET_COLUMNS.FLOOR] || "",
        property: detectedProperty,
      })
    }

    // Guide only to a single certain kiosk: same-name guests at different
    // kiosks or an unassigned beach room fall back to "not found".
    const lookedUp = normalizedGuestName !== null || !!reservationId
    const [only] = elsewhere.values()
    const redirect = lookedUp && reservations.length === 0 && elsewhere.size === 1 && only.near ? only.target : null

    console.log("[v0] Total reservations found:", reservations.length)

    return NextResponse.json({
      reservations,
      redirect,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Failed to fetch reservations", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

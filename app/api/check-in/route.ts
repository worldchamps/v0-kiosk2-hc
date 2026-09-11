import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { headers } from "next/headers"
import { createSheetsClient, SHEET_COLUMNS } from "@/lib/google-sheets"
import { completeReservationCheckIn } from "@/lib/check-in-operation"
import { getPropertyFromReservation, canCheckInAtKiosk } from "@/lib/property-utils"
import type { PropertyId } from "@/lib/property-utils"
import { getReservationStayEligibility } from "@/lib/date-utils"
import { getKioskScope, isRoomInBuilding, buildingRestrictionMessage } from "@/lib/kiosk-scope"

export async function POST(request: NextRequest) {
  try {
    const apiKey = (await headers()).get("x-api-key")
    if (apiKey && apiKey !== process.env.API_KEY && apiKey !== process.env.ADMIN_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const scope = getKioskScope()
    let body: any
    try { body = await request.json() } catch {
      return NextResponse.json({ error: "올바른 체크인 요청이 필요합니다." }, { status: 400 })
    }
    const reservationId = typeof body?.reservationId === "string" ? body.reservationId.trim() : ""
    if (!reservationId || reservationId.length > 200) {
      return NextResponse.json({ error: "Reservation ID is required" }, { status: 400 })
    }
    const sheets = createSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    if (!spreadsheetId) return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Reservations!A2:N" }, { timeout: 15000, retry: false })
    const rows = response.data.values || []
    const matches = rows.map((row, index) => ({ row, index }))
      .filter(({ row }) => String(row[SHEET_COLUMNS.RESERVATION_ID] || "").trim() === reservationId)
    if (!matches.length) return NextResponse.json({ error: "Reservation not found" }, { status: 404 })
    if (matches.length !== 1) {
      return NextResponse.json({ error: "같은 예약번호가 여러 건입니다. 관리자에게 확인해주세요." }, { status: 409 })
    }
    const { row, index } = matches[0]
    const field = (column: number) => String(row[column] || "")
    const roomNumber = field(SHEET_COLUMNS.ROOM_NUMBER)
    const checkInDate = field(SHEET_COLUMNS.CHECK_IN_DATE)
    const status = field(SHEET_COLUMNS.CHECK_IN_STATUS).trim()
    if (scope.building && !isRoomInBuilding(roomNumber, scope.building)) {
      return NextResponse.json({ error: "KIOSK_BUILDING_MISMATCH", message: buildingRestrictionMessage(scope.building) }, { status: 403 })
    }
    // New on-site rows can be Checked In while their payment/queue commit is still pending.
    // Recover through the original payment-bound booking request, not this legacy path.
    if (/^ONSITE-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId)) {
      return NextResponse.json({ error: "ON_SITE_BOOKING_RECOVERY_REQUIRED", message: "현장 결제 예약은 원래 예약·결제 화면에서 처리 결과를 확인해주세요. 관리자에게 문의해주세요." }, { status: 409 })
    }
    if (!roomNumber.trim()) return NextResponse.json({ error: "객실이 배정되지 않은 예약입니다." }, { status: 409 })
    // A request property/adminOverride cannot change this physical kiosk's scope.
    const property = getPropertyFromReservation({ roomNumber, place: field(SHEET_COLUMNS.PLACE) })
    const validation = property && canCheckInAtKiosk(property as PropertyId, scope.property, false)
    if (!validation || !validation.allowed) {
      return NextResponse.json({ error: "Property mismatch", message: validation ? validation.reason : "예약 숙소를 확인할 수 없습니다." }, { status: 403 })
    }
    if (status && !/^checked\s*in$/i.test(status)) {
      return NextResponse.json({ error: "RESERVATION_NOT_ACTIVE", message: "취소되었거나 입실할 수 없는 상태의 예약입니다. 관리자에게 확인해주세요." }, { status: 409 })
    }
    const eligibility = getReservationStayEligibility(checkInDate, field(SHEET_COLUMNS.CHECK_OUT_DATE))
    if (!eligibility.allowed) return NextResponse.json({ error: eligibility.code, ...eligibility }, { status: 409 })
    const result = await completeReservationCheckIn({
      property: scope.property, reservationId, roomNumber, checkInDate,
      guestName: field(SHEET_COLUMNS.GUEST_NAME), password: field(SHEET_COLUMNS.PASSWORD), floor: field(SHEET_COLUMNS.FLOOR),
      currentStatus: status, currentCheckInTime: field(SHEET_COLUMNS.CHECK_IN_TIME),
      writeCheckIn: async (checkInTime) => {
        // Revalidate the target row immediately before an initial or retried
        // cell assignment. A moved row or a manual change is not ours to edit.
        const fresh = await sheets.spreadsheets.values.get({
          spreadsheetId, range: `Reservations!A${index + 2}:N${index + 2}`,
        }, { timeout: 15000, retry: false })
        const current = fresh.data.values?.[0] || []
        const changed = () => Object.assign(new Error("Reservation row changed before saving"), { code: "CHECK_IN_ROW_CHANGED" })
        for (const column of [SHEET_COLUMNS.PLACE, SHEET_COLUMNS.GUEST_NAME, SHEET_COLUMNS.RESERVATION_ID,
          SHEET_COLUMNS.ROOM_NUMBER, SHEET_COLUMNS.CHECK_IN_DATE, SHEET_COLUMNS.CHECK_OUT_DATE]) {
          if (String(current[column] || "") !== field(column)) throw changed()
        }
        const currentStatus = String(current[SHEET_COLUMNS.CHECK_IN_STATUS] || "").trim()
        const currentTime = String(current[SHEET_COLUMNS.CHECK_IN_TIME] || "")
        if (/^checked\s*in$/i.test(currentStatus) && currentTime === checkInTime) return
        if (currentStatus || currentTime.trim()) throw changed()
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
            { range: `Reservations!L${index + 2}`, values: [["Checked In"]] },
            { range: `Reservations!M${index + 2}`, values: [[checkInTime]] },
          ] },
        }, { timeout: 15000, retry: false })
      },
    })
    return NextResponse.json(result, { status: result.success ? 200 : "pending" in result && result.pending ? 202 : 409 })
  } catch (error) {
    console.error("[check-in] Failed:", error)
    return NextResponse.json({ error: "체크인 처리 결과를 확인하지 못했습니다. 관리자에게 확인하거나 같은 예약으로 다시 확인해주세요." }, { status: 503 })
  }
}

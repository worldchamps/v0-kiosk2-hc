import { createHash } from "crypto"
import { getDB, getPaymentClaim } from "@/lib/firebase-admin"
import { normalizeDate, resolveReservationSheetDateTime } from "@/lib/date-utils"
import type { PropertyId } from "@/lib/property-utils"

export interface OnSiteBookingRecord {
  key: string
  fingerprint: string
  reservationId: string
  roomCode: string
  property: PropertyId
  state: "preparing" | "saving" | "saved" | "committing" | "complete" | "rejected"
  sheetRow: (string | number)[]
  data: Record<string, unknown>
  holdUntil: number
  error?: string
  canCancelPayment?: boolean
  payment?: { provider: "toss_pay" | "toss_front"; id: string }
}

export const bookingHash = (value: string) => createHash("sha256").update(value).digest("hex")
export const bookingRoomKey = (room: string) => room.replace(/[\s-]+/g, "").toUpperCase()
export const bookingRecordRef = (key: string) => getDB().ref(`kiosk_bookings/${key}`)
const roomClaimRef = (record: Pick<OnSiteBookingRecord, "property" | "roomCode">) =>
  getDB().ref(`kiosk_room_claims/${record.property}/${bookingRoomKey(record.roomCode)}`)

export function reservationTimestamp(value: string, fallback = "11:00") {
  const normalized = resolveReservationSheetDateTime(value, fallback)
  if (!normalized) return NaN
  return new Date(`${normalizeDate(normalized)}T${normalized.split("/")[1]}:00+09:00`).getTime()
}

// Match PMS's existing two-hour cleaning buffer. Unreadable schedules fail closed.
export function roomScheduleConflicts(rows: unknown[][], room: string, start: string, end: string) {
  const from = reservationTimestamp(start, "15:00"), to = reservationTimestamp(end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return true
  return rows.some(row => {
    if (bookingRoomKey(String(row[9] || "")) !== bookingRoomKey(room)) return false
    if (/^(cancelled|canceled|취소|예약취소)$/i.test(String(row[11] || "").trim())) return false
    const otherFrom = reservationTimestamp(String(row[7] || ""), "15:00")
    const otherTo = reservationTimestamp(String(row[8] || ""))
    return !Number.isFinite(otherFrom) || !Number.isFinite(otherTo) || otherTo <= otherFrom ||
      (from < otherTo + 7200000 && otherFrom < to + 7200000)
  })
}

export async function readOnSiteBooking(key: string): Promise<OnSiteBookingRecord | null> {
  return (await bookingRecordRef(key).once("value")).val()
}

export async function beginOnSiteBooking(record: OnSiteBookingRecord) {
  return (await bookingRecordRef(record.key).transaction(current => current ? undefined : record)).committed
}

export async function claimOnSiteRoom(record: OnSiteBookingRecord) {
  const result = await roomClaimRef(record).transaction(current => {
    // A pending payment/ambiguous save must never expire into a fresh sale.
    if (current && current.state !== "released" &&
        !(current.state === "complete" && Number(current.holdUntil) <= Date.now())) return
    return { key: record.key, state: "pending", holdUntil: record.holdUntil, reservationId: record.reservationId }
  })
  return result.committed
}

export async function rejectOnSiteBooking(record: OnSiteBookingRecord, error: string, canCancelPayment: boolean) {
  // Release only this request's claim, never a concurrent winner's claim.
  await roomClaimRef(record).transaction(current => current?.key === record.key
    ? { ...current, state: "released" } : undefined)
  await bookingRecordRef(record.key).update({ state: "rejected", error, canCancelPayment })
}

export async function getBlockedOnSiteRooms(property: PropertyId): Promise<Set<string>> {
  const claims = (await getDB().ref(`kiosk_room_claims/${property}`).once("value")).val() || {}
  return new Set(Object.entries(claims).filter(([, value]) => {
    const claim = value as { state: string; holdUntil: number }
    return claim.state !== "released" && !(claim.state === "complete" && claim.holdUntil <= Date.now())
  }).map(([room]) => room))
}

export async function finalizeOnSiteBooking(record: OnSiteBookingRecord): Promise<OnSiteBookingRecord> {
  if (record.payment && (await getPaymentClaim(record.payment.provider, record.payment.id))?.status === "canceled") {
    // A physical cancellation needs reconciliation, not a new room command.
    return record
  }
  const ref = bookingRecordRef(record.key)
  const claimed = await ref.transaction(current => current?.state === "saved" ? { ...current, state: "committing" } : undefined)
  if (!claimed.committed) return (await readOnSiteBooking(record.key)) || record

  // Room data can be replaced by PMS synchronisation: resolve its current key.
  // Durable operation/claim records deliberately live OUTSIDE beach_room_status.
  const rooms = (await getDB().ref("beach_room_status/rooms").once("value")).val() || {}
  const roomKey = Object.keys(rooms).find(key => bookingRoomKey(String(rooms[key].matchingRoomNumber || "")) === bookingRoomKey(record.roomCode))
  if (!roomKey) throw new Error("예약 객실의 현재 PMS 키를 찾지 못했습니다. 관리자 확인이 필요합니다.")
  // Existing local PMS consumers accept only queue keys beginning with '-'.
  const queueKey = `-kiosk-${record.key}`
  const complete = { ...record, state: "complete" as const }
  await getDB().ref().update({
    [`beach_room_status/rooms/${roomKey}/status`]: "사용 중",
    "beach_room_status/lastUpdated": new Date().toISOString(),
    [`pms_queue/${record.property}/${queueKey}`]: {
      id: queueKey, action: "checkin", roomNumber: record.roomCode,
      guestName: record.data.guestName, checkInDate: record.data.checkInDate,
      status: "pending", property: record.property, createdAt: new Date().toISOString(),
    },
    [`kiosk_bookings/${record.key}`]: complete,
    [`kiosk_room_claims/${record.property}/${bookingRoomKey(record.roomCode)}`]: {
      key: record.key, state: "complete", holdUntil: record.holdUntil, reservationId: record.reservationId,
    },
  })
  return complete
}

export async function resumeOnSiteBooking(record: OnSiteBookingRecord, readRows: () => Promise<unknown[][]>) {
  if (record.state === "saving") {
    // A timed-out Sheets append may have succeeded. Never append a second row.
    const matches = (await readRows()).filter(row => row[2] === record.reservationId)
    if (matches.length === 1 && record.sheetRow.every((value, index) => String(matches[0][index] ?? "") === String(value))) {
      const result = await bookingRecordRef(record.key).transaction(current => current?.state === "saving"
        ? { ...current, state: "saved" } : undefined)
      record = result.snapshot.val() || record
    }
  }
  if (record.state === "saved") return finalizeOnSiteBooking(record)
  // A committing write is atomic across room+queue+record. If its outcome is
  // unknown, read only; replaying it can re-create a queue job already consumed.
  return (await readOnSiteBooking(record.key)) || record
}

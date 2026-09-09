import { createHash } from "crypto"
import { getDB } from "@/lib/firebase-admin"

type CheckInData = {
  reservationId: string
  checkInTime: string
  status: string
  roomNumber: string
  password: string
  floor: string
}
type CheckInRecord = {
  state: "saving" | "committing" | "complete"
  property: string
  roomNumber: string
  checkInDate: string
  data: CheckInData
}
type Input = {
  property: string
  reservationId: string
  roomNumber: string
  guestName: string
  checkInDate: string
  password: string
  floor: string
  currentStatus: string
  currentCheckInTime: string
  writeCheckIn: (checkInTime: string) => Promise<unknown>
}

export async function completeReservationCheckIn(input: Input) {
  const operationId = createHash("sha256").update(`${input.property}:${input.reservationId}`).digest("hex")
  const database = getDB()
  // PMS replaces beach_room_status wholesale. Durable state must be outside it.
  const recordPath = `kiosk_checkins/${operationId}`
  const ref = database.ref(recordPath)
  const pending = () => ({ success: false, pending: true, operationId,
    error: "체크인 처리 결과를 확인 중입니다. 다른 객실로 이동하지 말고 같은 예약의 처리 결과를 다시 확인해주세요." })
  const matchesInput = (record: CheckInRecord) => record.property === input.property &&
    record.roomNumber === input.roomNumber && record.checkInDate === input.checkInDate
  const conflict = () => ({ success: false, conflict: true,
    error: "처리 중인 예약의 객실 또는 입실 일정이 변경되었습니다. 관리자에게 확인해주세요." })
  const done = (record: CheckInRecord) => matchesInput(record)
    ? { success: true, operationId, data: record.data } : conflict()
  const makeData = (checkInTime: string): CheckInData => ({
    reservationId: input.reservationId, checkInTime, status: "Checked In",
    roomNumber: input.roomNumber, password: input.password, floor: input.floor,
  })
  let record = (await ref.once("value")).val() as CheckInRecord | null
  if (record && !matchesInput(record)) return conflict()
  if (record?.state === "complete") return done(record)
  if (record?.state === "committing") return pending()
  const alreadyCheckedIn = /^checked\s*in$/i.test(input.currentStatus.trim())
  // Legacy check-ins have no record. Never replay their physical PMS actions.
  if (!record && alreadyCheckedIn) {
    return { success: true, alreadyCheckedIn: true, data: makeData(input.currentCheckInTime) }
  }
  if (!record) {
    const candidate: CheckInRecord = { state: "saving", property: input.property,
      roomNumber: input.roomNumber, checkInDate: input.checkInDate, data: makeData(new Date().toISOString()) }
    const acquired = await ref.transaction((current) => current ? undefined : candidate)
    record = acquired.snapshot.val() as CheckInRecord
    if (record && !matchesInput(record)) return conflict()
    if (!acquired.committed) return record?.state === "complete" ? done(record) : pending()
    try {
      await input.writeCheckIn(record.data.checkInTime)
    } catch {
      // Failed HTTP response does not prove the Sheets write failed. Never write twice.
      return pending()
    }
  } else if (!alreadyCheckedIn || input.currentCheckInTime !== record.data.checkInTime) {
    // Only a fresh, exact L/M read can reconcile an ambiguous Sheets write.
    return pending()
  }
  try {
    const committing = await ref.transaction((current: CheckInRecord | null) =>
      current?.state === "saving" && matchesInput(current) ? { ...current, state: "committing" } : undefined)
    if (!committing.committed) {
      const latest = committing.snapshot.val() as CheckInRecord | null
      return latest?.state === "complete" ? done(latest) : pending()
    }
    record = committing.snapshot.val() as CheckInRecord
    // Consumer accepts '-' keys and deletes finished jobs. Do not recreate them on retry.
    const queueId = `-kiosk-checkin-${operationId}`
    await database.ref().update({
      [recordPath]: { ...record, state: "complete" },
      [`pms_queue/${input.property}/${queueId}`]: {
        id: queueId, action: "checkin", roomNumber: input.roomNumber, guestName: input.guestName,
        checkInDate: input.checkInDate, status: "pending", property: input.property,
        source: "kiosk", createdAt: record.data.checkInTime,
      },
    })
    return done(record)
  } catch {
    // An ambiguous atomic commit stays pending unless a later read observes complete.
    // Retrying the write could recreate a job already executed and deleted by the consumer.
    return pending()
  }
}

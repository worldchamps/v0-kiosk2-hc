import { createHash, randomUUID } from "crypto"
import { getDB } from "@/lib/firebase-admin"
import { transactionWithReadCache } from "@/lib/firebase-transaction"

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
  writeAttemptAt?: number
  writeAttemptId?: string
  lastWriteError?: string
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
  const pending = (reason = "") => ({ success: false, pending: true, operationId,
    error: reason || record?.lastWriteError || "체크인 처리 결과를 확인 중입니다. 다른 객실로 이동하지 말고 같은 예약의 처리 결과를 다시 확인해주세요." })
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
  let writeAttemptId = ""
  if (!record) {
    writeAttemptId = randomUUID()
    const candidate: CheckInRecord = { state: "saving", property: input.property,
      roomNumber: input.roomNumber, checkInDate: input.checkInDate, data: makeData(new Date().toISOString()),
      writeAttemptAt: Date.now(), writeAttemptId }
    const acquired = await ref.transaction((current) => current ? undefined : candidate)
    record = acquired.snapshot.val() as CheckInRecord
    if (record && !matchesInput(record)) return conflict()
    if (!acquired.committed) return record?.state === "complete" ? done(record) : pending()
  } else if (!alreadyCheckedIn || input.currentCheckInTime !== record.data.checkInTime) {
    // Retry only the identical L/M assignment, never a new check-in timestamp or
    // an append. Nonempty/partial/manual records must not be overwritten.
    if (input.currentStatus.trim() || input.currentCheckInTime.trim()) return pending()
    writeAttemptId = randomUUID()
    const retry = await transactionWithReadCache(ref, (current: CheckInRecord | null) => {
      if (current?.state !== "saving" || !matchesInput(current)) return undefined
      const lastAttempt = current.writeAttemptAt ?? Date.parse(current.data.checkInTime)
      // A lease outlasts the fresh read plus write (15s each). Concurrent presses wait;
      // after an ambiguous timeout the fixed cell values remain idempotent.
      if (!Number.isFinite(lastAttempt) || Date.now() - lastAttempt < 60000) return undefined
      return { ...current, writeAttemptAt: Date.now(), writeAttemptId, lastWriteError: "" }
    })
    const latest = retry.snapshot.val() as CheckInRecord | null
    if (latest && !matchesInput(latest)) return conflict()
    if (!retry.committed) return latest?.state === "complete" ? done(latest) : pending(latest?.lastWriteError)
    record = latest!
  }
  if (writeAttemptId) {
    try {
      await input.writeCheckIn(record.data.checkInTime)
    } catch (error) {
      const failure = error as { code?: unknown; response?: { status?: unknown } }
      const status = Number(failure?.response?.status ?? failure?.code)
      const reason = failure?.code === "CHECK_IN_ROW_CHANGED"
        ? "예약표 내용이 변경되어 입실 기록을 저장하지 않았습니다. 관리자에게 확인해주세요."
        : status === 401 || status === 403
          ? "예약표 저장 인증 또는 수정 권한을 확인해야 합니다. 관리자에게 문의해주세요."
          : "예약표 입실 기록을 저장하지 못했거나 응답을 확인하지 못했습니다. 1분 후 같은 예약으로 다시 확인해주세요."
      // Store only an allowlisted reason, never a provider error/token/URL.
      console.error("[check-in] Sheets write not confirmed", { operationId, status: Number.isFinite(status) ? status : "unknown" })
      await transactionWithReadCache(ref, (current: CheckInRecord | null) =>
        current?.state === "saving" && matchesInput(current) && current.writeAttemptId === writeAttemptId
          ? { ...current, lastWriteError: reason } : undefined).catch(() => {})
      return pending(reason)
    }
  }
  try {
    const committing = await transactionWithReadCache(ref, (current: CheckInRecord | null) =>
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

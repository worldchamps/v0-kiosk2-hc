import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createSheetsClient } from "@/lib/google-sheets"
import { claimPayment, releasePaymentClaim, getPaymentClaim } from "@/lib/firebase-admin"
import { transactionWithReadCache } from "@/lib/firebase-transaction"
import { getRoomInfoByMatchingNumber } from "@/lib/firebase-beach-rooms"
import { getPropertyFromRoomNumber } from "@/lib/property-utils"
import { isShortStayAvailable, isShortStayRestrictedProperty } from "@/lib/short-stay-policy"
import { getPmsRateAmount } from "@/lib/pms-rates"
import { verifyCompletedCardPayment } from "@/lib/toss-pay"
import { verifyTossFrontPaymentProof } from "@/lib/toss-front"
import { buildOnSiteSheetDateTimes, formatCurrentSheetDateTime, normalizeDate, getReservationStayEligibility } from "@/lib/date-utils"
import { getKioskScope, isRoomInBuilding, buildingRestrictionMessage } from "@/lib/kiosk-scope"
import { findKioskRoomSalesConfig, getKioskSalesConfig, isKioskSalesWindowOpen } from "@/lib/kiosk-sales-config"
import {
  bookingHash, bookingRoomKey, bookingRecordRef, readOnSiteBooking, beginOnSiteBooking,
  claimOnSiteRoom, rejectOnSiteBooking, finalizeOnSiteBooking, resumeOnSiteBooking,
  reservationTimestamp, roomScheduleConflicts, type OnSiteBookingRecord,
} from "@/lib/on-site-bookings"

const pending = (record?: OnSiteBookingRecord) => NextResponse.json({
  success: false, pending: true, canCancelPayment: false,
  reservationId: record?.reservationId,
  error: "예약·결제 처리 결과를 확인 중입니다. 다시 결제하지 말고 예약 상태를 다시 확인하거나 관리자에게 문의해 주세요.",
}, { status: 202 })
const resultOf = (record: OnSiteBookingRecord) => {
  if (record.state === "complete") {
    const stay = getReservationStayEligibility(String(record.data.checkInDate || ""), String(record.data.checkOutDate || ""))
    if (!stay.allowed) return NextResponse.json({ success: false, canCancelPayment: false, error: stay.message }, { status: 409 })
    return NextResponse.json({ success: true, data: record.data })
  }
  return record.state === "rejected"
    ? NextResponse.json({ success: false, canCancelPayment: record.canCancelPayment === true, error: record.error }, { status: 409 })
    : pending(record)
}

export async function POST(request: NextRequest) {
  let record: OnSiteBookingRecord | undefined
  let ownsRecord = false
  let appendAttempted = false
  let safeToCancel = false
  let claimedPayment: { provider: "toss_pay" | "toss_front"; id: string } | null = null
  const reject = (error: string, status = 400) =>
    NextResponse.json({ success: false, error, canCancelPayment: safeToCancel }, { status })

  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject("올바른 예약 정보가 필요합니다.")
    let scope
    try { scope = getKioskScope() } catch { return reject("키오스크 숙소·동 설정을 확인해 주세요.", 503) }
    if (scope.building && !isRoomInBuilding(body.roomCode, scope.building)) return reject(buildingRestrictionMessage(scope.building), 403)
    if (typeof body.roomCode !== "string") return reject("객실 정보가 필요합니다.")
    const roomCode = bookingRoomKey(body.roomCode)
    const property = getPropertyFromRoomNumber(roomCode)
    if (!property || property !== scope.property) return reject("이 키오스크에서 처리할 수 없는 숙소입니다.", 403)
    const { payment, guestName, phoneNumber, roomType, stayType } = body
    if (![guestName, phoneNumber, roomType].every(value => typeof value === "string" && value.trim() && value.length <= 200) ||
        !["overnight", "shortStay"].includes(stayType) || !["CARD", "CASH"].includes(payment?.method)) {
      return reject("예약 정보 또는 결제수단을 확인해 주세요.")
    }
    const provider = payment.provider === "TOSS_FRONT" ? "toss_front" : "toss_pay"
    const paymentId = provider === "toss_front" ? payment.front?.paymentKey : payment.payToken
    const sourceId = payment.method === "CARD" ? paymentId : body.requestId
    if (typeof sourceId !== "string" || sourceId.length < 8 || sourceId.length > 300 ||
        (payment.method === "CASH" && !/^[a-zA-Z0-9_-]{16,100}$/.test(sourceId))) {
      return reject("결제 요청 식별자가 없습니다. 관리자에게 문의해 주세요.")
    }
    const key = bookingHash((payment.method === "CARD" ? provider : "cash") + ":" + sourceId)
    const fingerprint = bookingHash(JSON.stringify([property, roomCode, stayType, body.price, guestName, phoneNumber,
      roomType, body.checkInDate, body.checkOutDate, payment.method, payment.provider || "", payment.payToken || "",
      payment.orderNo || "", payment.front || null]))
    const existing = await readOnSiteBooking(key)
    if (existing && existing.fingerprint !== fingerprint) return reject("같은 결제 요청을 다른 예약에 사용할 수 없습니다.", 409)
    const previousPayment = payment.method === "CARD" ? await getPaymentClaim(provider, paymentId) : null
    if (previousPayment?.status === "canceled") return reject("이미 취소된 카드 결제입니다. 관리자에게 문의해 주세요.", 409)
    if (previousPayment && !existing) return reject("이미 예약에 사용된 카드 결제입니다. 관리자에게 문의해 주세요.", 409)

    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    if (!spreadsheetId) return reject("예약 서버 설정을 확인해 주세요.", 503)
    const sheets = createSheetsClient()
    const readRows = async (): Promise<unknown[][]> =>
      (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Reservations!A:N",
        valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING",
      }, { timeout: 15000, retry: false })).data.values || []

    // Recover the same request before rechecking changed prices, sales windows
    // or vacancy. Its payment and payload are bound to the persisted fingerprint.
    if (existing) {
      record = existing
      return resultOf(await resumeOnSiteBooking(existing, readRows))
    }

    const salesConfig = await getKioskSalesConfig(property)
    const configuredRoom = findKioskRoomSalesConfig(salesConfig, roomCode)
    const stayEnabled = stayType === "overnight" ? configuredRoom?.overnightEnabled : configuredRoom?.shortStayEnabled
    const configuredRates = configuredRoom?.rates[stayType as "overnight" | "shortStay"]
    const price = salesConfig
      ? (payment.method === "CARD" ? configuredRates?.card : configuredRates?.cash)
      : await getPmsRateAmount({ roomCode, stayType, paymentMethod: payment.method })
    if (!price || !Number.isFinite(price) || price <= 0) return reject("유효한 PMS 요금을 확인하지 못했습니다.")
    if (payment.method === "CARD") {
      try {
        if (provider === "toss_front") verifyTossFrontPaymentProof(payment.front, price)
        else {
          if (!payment.payToken || !payment.orderNo) return reject("카드 결제 정보가 누락되었습니다.")
          await verifyCompletedCardPayment({ payToken: payment.payToken, orderNo: payment.orderNo, expectedAmount: price })
        }
      } catch {
        return reject("카드 결제 확인에 실패했습니다. 관리자에게 문의해 주세요.", 402)
      }
    }
    safeToCancel = true
    if (Number(body.price) !== price) return reject("결제 중 PMS 요금이 변경되었습니다. 관리자에게 문의해 주세요.", 409)
    if (salesConfig && (!configuredRoom?.enabled || !stayEnabled || !isKioskSalesWindowOpen(salesConfig.policy, stayType))) {
      return reject("현재 PMS 설정에서 판매 중지된 객실 또는 이용 유형입니다.", 403)
    }
    if (!salesConfig && stayType === "shortStay" && isShortStayRestrictedProperty(property) && !isShortStayAvailable()) {
      return reject("대실 예약은 오후 9시 이전에만 가능합니다.", 403)
    }
    const now = new Date()
    const dates = buildOnSiteSheetDateTimes(normalizeDate(formatCurrentSheetDateTime(now)),
      normalizeDate(formatCurrentSheetDateTime(new Date(now.getTime() + 86400000))), stayType, now, {
        shortStayDurationMinutes: salesConfig?.policy.shortStayDurationMinutes,
        overnightCheckoutTime: salesConfig?.policy.overnightCheckoutTime,
      })
    const reservationId = "ONSITE-" + randomUUID()
    const data: Record<string, unknown> = { reservationId, guestName, roomNumber: roomCode, roomCode, roomType, price,
      ...dates, stayType, stayTypeLabel: stayType === "overnight" ? "숙박" : "대실", password: "", paymentReceipt: null }
    if (provider === "toss_front" && payment.method === "CARD") {
      const front = payment.front
      data.paymentReceipt = { provider: "TOSS_FRONT", amount: front.amount, tax: front.tax, supplyValue: front.supplyValue,
        approvalNumber: front.approvalNumber, timestamp: front.timestamp, installment: front.installment,
        issuerName: front.issuerName || "", maskedCardNumber: front.maskedCardNumber || "", tid: front.tid || "" }
    }
    record = { key, fingerprint, reservationId, roomCode, property, state: "preparing", data, sheetRow: [],
      holdUntil: reservationTimestamp(dates.checkOutDate) + 7200000 }
    if (payment.method === "CARD") record.payment = { provider, id: paymentId }
    if (!Number.isFinite(record.holdUntil)) return reject("입퇴실 시간을 확인해 주세요.")
    ownsRecord = await beginOnSiteBooking(record)
    if (!ownsRecord) {
      const winner = await readOnSiteBooking(key)
      if (!winner || winner.fingerprint !== fingerprint) {
        safeToCancel = false
        return reject("같은 요청의 처리 결과를 관리자에게 확인해 주세요.", 409)
      }
      record = winner
      return resultOf(await resumeOnSiteBooking(winner, readRows))
    }
    if (!await claimOnSiteRoom(record)) {
      await rejectOnSiteBooking(record, "이 객실은 예약 처리 중입니다. 다른 객실을 선택해 주세요.", true)
      return reject("이 객실은 예약 처리 중입니다. 다른 객실을 선택해 주세요.", 409)
    }
    const roomInfo = await getRoomInfoByMatchingNumber(roomCode)
    const vending = typeof roomInfo?.vendingAvailable === "string" ? roomInfo.vendingAvailable.trim().toUpperCase() : roomInfo?.vendingAvailable
    if (!roomInfo || roomInfo.status !== "공실" || String(roomInfo.unavailable || "").trim().toUpperCase() === "X" ||
        [false, "X", "N", "FALSE", "0"].includes(vending as string | boolean)) {
      await rejectOnSiteBooking(record, "판매 가능한 공실이 아닙니다. 다른 객실을 선택해 주세요.", true)
      return reject("판매 가능한 공실이 아닙니다. 다른 객실을 선택해 주세요.", 409)
    }
    if (roomScheduleConflicts(await readRows(), roomCode, dates.checkInDate, dates.checkOutDate)) {
      await rejectOnSiteBooking(record, "기존 예약 또는 청소 준비 시간과 겹칩니다. 다른 객실을 선택해 주세요.", true)
      return reject("기존 예약 또는 청소 준비 시간과 겹칩니다. 다른 객실을 선택해 주세요.", 409)
    }
    data.password = roomInfo.password || ""
    data.floor = roomInfo.floor || ""
    data.phoneNumber = phoneNumber
    record.roomCode = roomInfo.matchingRoomNumber
    data.roomCode = record.roomCode
    data.roomNumber = record.roomCode
    record.sheetRow = [property === "property4" ? "더 캠프스테이" : property === "property2" ? "카리브" : "경주 더 비치스테이",
      guestName, reservationId, "키오스크", roomType, price, phoneNumber, dates.checkInDate, dates.checkOutDate,
      record.roomCode, roomInfo.password || "", "Checked In", dates.checkInDate, roomInfo.floor || ""]
    if (payment.method === "CARD") {
      const details = { ...(provider === "toss_front" ? payment.front : { orderNo: payment.orderNo }), reservationId,
        roomCode, stayType, amount: price }
      if (!await claimPayment(provider, paymentId, details)) {
        safeToCancel = false
        await rejectOnSiteBooking(record, "이미 사용된 카드 결제입니다. 관리자에게 문의해 주세요.", false)
        return reject("이미 사용된 카드 결제입니다. 관리자에게 문의해 주세요.", 409)
      }
      claimedPayment = { provider, id: paymentId }
    }
    // Persist the exact intended row BEFORE the uncertain external write.
    record.state = "saving"
    await bookingRecordRef(key).set(record)
    appendAttempted = true
    safeToCancel = false
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "Reservations!A:N", valueInputOption: "RAW",
      requestBody: { values: [record.sheetRow] } }, { timeout: 15000, retry: false })
    // A retry may have reconciled the visible row while this append response
    // was delayed. Never rewind complete/committing or recreate a consumed job.
    const saved = await transactionWithReadCache(bookingRecordRef(key), current => current?.state === "saving"
      ? { ...current, state: "saved" } : undefined)
    record = saved.snapshot.val() || record
    if (!record) return pending()
    return resultOf(record.state === "saved" ? await finalizeOnSiteBooking(record) : record)
  } catch (error) {
    console.error("[Kiosk booking] Processing requires verification:", error instanceof Error ? error.message : "Unknown error")
    if (record && ownsRecord && !appendAttempted) {
      try {
        if (claimedPayment) await releasePaymentClaim(claimedPayment.provider, claimedPayment.id)
        await rejectOnSiteBooking(record, "예약 저장 전에 오류가 발생했습니다. 관리자에게 문의해 주세요.", safeToCancel)
        return reject("예약 저장 전에 오류가 발생했습니다. 관리자에게 문의해 주세요.", 503)
      } catch { /* Unknown durable-write outcome: do not pretend cancellation is safe. */ }
    }
    return pending(record)
  }
}

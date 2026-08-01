const RESERVATION_QR_PREFIX = "AGAIN:RESERVATION:"

export function parseReservationQrValue(value: string) {
  const normalized = value.trim()

  if (!normalized.startsWith(RESERVATION_QR_PREFIX)) {
    throw new Error("AGAIN 예약 QR이 아닙니다.")
  }

  const reservationId = normalized.slice(RESERVATION_QR_PREFIX.length)
  if (!reservationId || reservationId.includes(":") || /\s/.test(reservationId)) {
    throw new Error("예약 QR 형식이 올바르지 않습니다.")
  }

  return reservationId
}

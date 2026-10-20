export function requiresPmsBalance(bookingPlatform: string) {
  const channel = bookingPlatform.trim()
  return /^현장/.test(channel) || /^직접예약/.test(channel) || channel === "전화예약"
}

export function isCollectionRecorded(status: string) {
  return status === "recorded" || status === "duplicate"
}

export function cashCollectionAmount(remaining: number, cashBackend?: string | null) {
  if (remaining % 1000 !== 0 || cashBackend === "bac2400" && remaining % 10000 !== 0) return 0
  return remaining
}

export function collectionPaidAt(timestamp: number, now = Date.now()) {
  const milliseconds = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const valid = Number.isFinite(milliseconds) && milliseconds >= Date.UTC(2020, 0, 1) &&
    milliseconds <= now + 86400000
  return new Date(valid ? milliseconds : now).toISOString()
}

export async function submitCollection(body: string, timeoutMs = 10000): Promise<string> {
  try {
    const response = await fetch("/api/reservation-collection", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const result = await response.json()
    if (!["recorded", "duplicate", "stale", "not_payable", "conflict", "error", "in_progress", "amount_mismatch", "uncertain"].includes(result?.status)) return "error"
    if (response.status >= 500) return "error"
    if (isCollectionRecorded(result.status) &&
        (!response.ok || result.reservationId !== JSON.parse(body).reservationId)) return "error"
    return result.status
  } catch {
    return "error"
  }
}

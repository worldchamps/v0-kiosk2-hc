import "server-only"

let warned = false

export function pmsKioskConfig() {
  const baseUrl = process.env.PMS_BASE_URL?.trim().replace(/\/+$/, "")
  const key = process.env.PMS_KIOSK_KEY?.trim()
  const kioskId = process.env.KIOSK_DEVICE_ID?.trim()
  if (!baseUrl || !key || key.length < 32 || !kioskId) {
    if (!warned) {
      console.warn("[PMS] Reservation collection disabled: kiosk connection settings incomplete.")
      warned = true
    }
    return null
  }
  return { baseUrl, key, kioskId }
}

export function pmsFetch(path: string, init: RequestInit, timeoutMs: number) {
  const config = pmsKioskConfig()
  if (!config) throw new Error("PMS kiosk connection unavailable")
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${config.key}`)
  return fetch(`${config.baseUrl}${path}`, {
    ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
  })
}

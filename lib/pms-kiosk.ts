import "server-only"

declare global {
  var kioskDeviceIdToken: (() => Promise<string>) | undefined
}

let warned = false

export function pmsKioskConfig() {
  const baseUrl = (process.env.PMS_BASE_URL?.trim() || "https://v0-pms-seven.vercel.app").replace(/\/+$/, "")
  const idToken = globalThis.kioskDeviceIdToken
  const kioskId = process.env.KIOSK_DEVICE_ID
  if (typeof idToken !== "function" || !kioskId || !/^[A-Za-z0-9_-]{1,200}$/.test(kioskId)) {
    if (!warned) {
      console.warn("[PMS] Reservation collection disabled: kiosk connection settings incomplete.")
      warned = true
    }
    return null
  }
  return { baseUrl, idToken, kioskId }
}

export async function pmsFetch(path: string, init: RequestInit, timeoutMs: number) {
  const config = pmsKioskConfig()
  if (!config) throw new Error("PMS kiosk connection unavailable")
  const signal = AbortSignal.timeout(timeoutMs)
  let onAbort: () => void
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const token = await Promise.race([config.idToken(), aborted])
    signal.throwIfAborted()
    if (typeof token !== "string" || !token || token.length > 4096) throw new Error("PMS kiosk token unavailable")
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("X-PMS-Kiosk-Device", config.kioskId)
    return await fetch(`${config.baseUrl}${path}`, {
      ...init, headers, cache: "no-store", redirect: "error", signal,
    })
  } finally {
    signal.removeEventListener("abort", onAbort!)
  }
}

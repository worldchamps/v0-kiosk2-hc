import { NextResponse, type NextRequest } from "next/server"
import { getDB } from "@/lib/firebase-admin"
import { getKioskScope } from "@/lib/kiosk-scope"
import { verifyScreen, MAX_IMAGE_LENGTH } from "@/electron/kiosk-screen"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length")) > MAX_IMAGE_LENGTH + 2000) return NextResponse.json({ error: "Too large" }, { status: 413 })
    const raw = await request.text()
    if (raw.length > MAX_IMAGE_LENGTH + 2000) return NextResponse.json({ error: "Too large" }, { status: 413 })
    const body = JSON.parse(raw)
    const scope = getKioskScope()
    if (!verifyScreen(body, request.headers.get("x-kiosk-screen-signature"), process.env.FIREBASE_PRIVATE_KEY,
      { deviceId: process.env.KIOSK_DEVICE_ID, property: scope.property, building: scope.building || "" })) {
      return NextResponse.json({ error: "Invalid screen report" }, { status: 403 })
    }
    const db = getDB()
    const lease = (await db.ref(`kiosk_screens/requests/${body.deviceId}`).once("value")).val()
    const captureUntil = typeof lease?.expiresAt === "number" && lease.expiresAt > Date.now() ? lease.expiresAt : 0
    const updates: Record<string, unknown> = {
      [`kiosk_screens/devices/${body.deviceId}`]: { property: scope.property, building: scope.building || "", version: body.version,
        lastSeen: Date.now(), captureError: body.captureError === true },
    }
    if (captureUntil && body.image) updates[`kiosk_screens/frames/${body.deviceId}`] = { image: body.image, capturedAt: body.at }
    if (!captureUntil) updates[`kiosk_screens/frames/${body.deviceId}`] = null
    await db.ref().update(updates)
    return NextResponse.json({ captureUntil })
  } catch { return NextResponse.json({ error: "Screen connection unavailable" }, { status: 503 }) }
}

import { NextResponse } from "next/server"
import { getDB } from "@/lib/firebase-admin"
import { getKioskScope } from "@/lib/kiosk-scope"
import { getRoomInfoByMatchingNumber } from "@/lib/firebase-beach-rooms"
import { verifyRequest } from "@/electron/pms-card-request"

export const dynamic = "force-dynamic"
function queue() {
  const scope = getKioskScope()
  if (!(scope.property === "property1" || scope.property === "property3" && scope.building === "A") ||
      !process.env.KIOSK_DEVICE_ID || process.env.CARD_DISPENSER_ENABLED !== "true") throw Error("카드 발급기 설정이 필요합니다.")
  return getDB().ref(`kiosk_key_jobs/${scope.property}`)
}
export async function GET() {
  try {
    const snapshot = await queue().orderByChild("request/createdAt").limitToLast(50).once("value")
    const jobs = Object.entries(snapshot.val() || {}).filter(([id, job]: [string, any]) => {
      try { return verifyRequest(job, process.env).id === id && ["pending", "processing"].includes(job.status) }
      catch { return false }
    }).map(([id]) => id)
    return NextResponse.json({ jobs })
  } catch { return NextResponse.json({ jobs: [] }) }
}
export async function POST(request: Request) {
  try {
    const { id, action, error, cardIssued } = await request.json()
    if (!/^[a-f0-9-]{36}$/.test(id || "")) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 })
    const ref = queue().child(id)
    const existing = (await ref.once("value")).val()
    const claim = verifyRequest(existing, process.env)
    if (claim.id !== id) throw Error("잘못된 요청입니다.")
    const room = action === "claim" ? await getRoomInfoByMatchingNumber(claim.room) : null
    if (action === "claim" && !room) throw Error("객실 정보를 확인하지 못했습니다.")
    const result = await ref.transaction(current => {
      if (!current || current.signature !== existing.signature || JSON.stringify(current.request) !== JSON.stringify(existing.request)) return
      if (action === "claim" && ["pending", "processing"].includes(current.status))
        return { ...current, status: "processing", startedAt: current.startedAt || new Date().toISOString() }
      if (action === "printing" && current.status === "processing")
        return { ...current, status: "printing", cardIssued: true }
      if (action === "complete" && current.status === "printing" || action === "fail" && ["processing", "printing"].includes(current.status))
        return { ...current, status: action === "complete" ? "completed" : "failed", cardIssued: current.cardIssued === true || cardIssued === true,
          error: action === "fail" ? String(error || "현장 확인이 필요합니다.").slice(0, 200) : "", completedAt: new Date().toISOString() }
    })
    if (!result.committed) return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 })
    return NextResponse.json(action === "claim" ? {
      envelope: { request: existing.request, signature: existing.signature },
      receipt: { roomNumber: claim.room, password: claim.room.startsWith("C") ? "" : room?.password || "", floor: room?.floor || "" },
    } : { success: true })
  } catch { return NextResponse.json({ error: "원격 배출 요청을 확인하지 못했습니다." }, { status: 400 }) }
}

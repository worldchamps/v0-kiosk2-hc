import { logAssistantPreview, previewSessionId } from "@/lib/kiosk-assistant-preview-log"

const events = new Set(["connected", "ended", "disconnected", "timeout", "connection_error", "permission_denied", "playback_blocked"])

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 })
  const body = await request.json().catch(() => null)
  const sessionId = previewSessionId(body?.sessionId)
  if (!sessionId || !events.has(body?.event)) return new Response(null, { status: 400 })
  logAssistantPreview(body.event, { sessionId })
  return new Response(null, { status: 204 })
}

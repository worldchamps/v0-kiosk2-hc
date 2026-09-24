import { NextResponse } from "next/server"
import { GET as getSellableRooms } from "@/app/api/available-rooms/route"
import { assistantAnswer, assistantTopics, isAssistantTopic, type AssistantTopic } from "@/lib/kiosk-assistant-content"
import { getKioskScope, isRoomInBuilding } from "@/lib/kiosk-scope"
import { getPropertyFromRoomNumber } from "@/lib/property-utils"
import { createSpeechToken } from "@/lib/kiosk-assistant-speech"

export const dynamic = "force-dynamic"

// Only these fixed labels reach Gemini; a guest's words stay on this server.
const topicHints: { topic: AssistantTopic; pattern: RegExp }[] = [
  { topic: "availability", pattern: /빈\s*방|(?:객실|방).*?(?:있|남|가능|비었)/ },
  { topic: "checkin", pattern: /체크인|입실/ },
  { topic: "transfer", pattern: /계좌이체|현금|결제 방법/ },
  { topic: "key", pattern: /키|열쇠|출입/ },
  { topic: "directions", pattern: /어디|길|층|건물|동/ },
  { topic: "checkout", pattern: /체크아웃|퇴실/ },
  { topic: "payment", pattern: /결제|승인|카드|돈/ },
  { topic: "reservation", pattern: /예약|조회|QR/ },
]
const sensitive = /\d{2,}|@|예약\s*번호|전화\s*번호|비밀번호|카드\s*번호|계좌\s*번호|주민등록|(?:제|내)\s*이름/

export function POST(request: Request) {
  if (!request.headers.get("Accept")?.includes("application/x-ndjson")) return answerRequest(request)
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      send({ type: "status", text: "질문을 확인하고 있어요…" })
      try {
        const response = await answerRequest(request)
        const result = await response.json()
        if (!response.ok || typeof result.answer !== "string") {
          send({ type: "error", text: result.error || "안내를 확인하지 못했습니다." })
          return
        }
        for (const part of result.answer.match(/\S+\s*/g) || [result.answer]) {
          if (request.signal.aborted) return
          send({ type: "delta", text: part })
          await new Promise(resolve => setTimeout(resolve, 40))
        }
        send({ type: "done", topic: result.topic, speechToken: result.speechToken })
      } catch {
        send({ type: "error", text: "지금은 안내를 확인하지 못했습니다. 직원에게 연락해 주세요." })
      } finally { controller.close() }
    },
  })
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } })
}

async function answerRequest(request: Request) {
  let scope
  try {
    scope = getKioskScope()
  } catch {
    return NextResponse.json({ error: "키오스크 설정을 확인하지 못했습니다." }, { status: 503 })
  }

  let input: unknown
  try { input = await request.json() } catch { return NextResponse.json({ error: "질문을 확인해 주세요." }, { status: 400 }) }
  const body = input as Record<string, unknown> | null
  const question = typeof body?.question === "string" ? body.question.trim() : ""
  if (!question || question.length > 200) return NextResponse.json({ error: "질문은 200자 이내로 입력해 주세요." }, { status: 400 })
  if (body?.topic !== undefined && !isAssistantTopic(body.topic)) return NextResponse.json({ error: "안내 주제를 확인해 주세요." }, { status: 400 })
  const screen = typeof body?.screen === "string" && body.screen.length <= 48 ? body.screen : ""
  const stateMismatch = /(안\s*(?:나와|나옵|돼|됩)|없|오류|실패|못|이상)/.test(question) &&
    /(키|열쇠|출입|체크인|입실|결제)/.test(question)
  if (sensitive.test(question) || stateMismatch) {
    const answer = sensitive.test(question)
      ? "개인정보는 말하지 말고 화면에서 직접 확인해 주세요. 어려우면 직원에게 연락해 주세요."
      : "화면 상태를 확인할 수 없습니다. 더 진행하지 말고 직원에게 연락해 주세요."
    return NextResponse.json({ topic: "other", answer,
      speechToken: process.env.GEMINI_API_KEY ? createSpeechToken(answer, process.env.GEMINI_API_KEY) : null,
    }, { headers: { "Cache-Control": "no-store" } })
  }
  const allowed = topicHints.filter(hint => hint.pattern.test(question)).map(hint => hint.topic)
  if (!isAssistantTopic(body?.topic) && allowed.length && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "AI 안내 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  try {
    // Realtime already selects an allowed topic; both paths return the same fixed guidance.
    let topic: AssistantTopic = isAssistantTopic(body?.topic) ? body.topic : "other"
    if (!isAssistantTopic(body?.topic) && allowed.length) {
      const decision = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text:
            `키오스크 안내 주제를 하나 고르세요. JSON으로 {"topic":"..."}만 답하세요.\n` +
            `가능한 주제: ${allowed.map(key => `${key}=${assistantTopics[key]}`).join(", ")}`,
          }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
        signal: AbortSignal.timeout(12000),
      })
      if (!decision.ok) throw new Error("Gemini request failed")
      const result = await decision.json()
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text
      try {
        const selected = JSON.parse(typeof text === "string" ? text : "{}")?.topic
        topic = isAssistantTopic(selected) && allowed.includes(selected) ? selected : "other"
      } catch { topic = "other" }
    }

    let availableCount: number | null = null
    if (topic === "availability" && process.env.VERCEL_ENV !== "preview") {
      const rooms = await getSellableRooms(new Request("http://kiosk.local/api/available-rooms"))
      if (rooms.ok) {
        const data = await rooms.json()
        if (Array.isArray(data.availableRooms)) availableCount = data.availableRooms.filter((room: { roomCode?: unknown }) =>
          typeof room.roomCode === "string" && getPropertyFromRoomNumber(room.roomCode) === scope.property &&
          isRoomInBuilding(room.roomCode, scope.building),
        ).length
      }
    }

    const answer = assistantAnswer(topic, {
      screen, building: scope.building, availableCount,
    })
    return NextResponse.json({ topic, answer,
      speechToken: process.env.GEMINI_API_KEY ? createSpeechToken(answer, process.env.GEMINI_API_KEY) : null,
    }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "지금은 AI 답변을 확인하지 못했습니다. 잠시 후 다시 시도하거나 직원에게 문의해 주세요." }, { status: 502 })
  }
}

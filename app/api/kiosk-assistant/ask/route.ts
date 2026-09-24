import { NextResponse } from "next/server"
import { GET as getSellableRooms } from "@/app/api/available-rooms/route"
import { assistantAnswer, assistantTopics, type AssistantTopic } from "@/lib/kiosk-assistant-content"
import { getKioskScope, isRoomInBuilding } from "@/lib/kiosk-scope"
import { getPropertyFromRoomNumber } from "@/lib/property-utils"
import { formatDateTimeKorean } from "@/lib/date-utils"
import { createSpeechToken } from "@/lib/kiosk-assistant-speech"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
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
  if (!process.env.TYPESAFE_API_KEY) return NextResponse.json({ error: "AI 안내 서비스가 설정되지 않았습니다." }, { status: 503 })

  try {
    const decision = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: { question },
        questions: { topic: { type: "choice", instructions: "고객 질문의 주제를 하나만 고르세요. 불분명하면 other를 고르세요.", criteria: assistantTopics } },
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!decision.ok) throw new Error("Jev request failed")
    const result = await decision.json()
    const selected = result?.answers?.topic
    const topic: AssistantTopic = selected?.type === "choice" &&
      typeof selected.choice === "string" && Object.hasOwn(assistantTopics, selected.choice) &&
      typeof selected.confidence === "number" && selected.confidence >= 0.55
      ? selected.choice as AssistantTopic : "other"

    let availableCount: number | null = null
    if (topic === "availability") {
      const rooms = await getSellableRooms(new Request("http://kiosk.local/api/available-rooms"))
      if (rooms.ok) {
        const data = await rooms.json()
        if (Array.isArray(data.availableRooms)) availableCount = data.availableRooms.filter((room: { roomCode?: unknown }) =>
          typeof room.roomCode === "string" && getPropertyFromRoomNumber(room.roomCode) === scope.property &&
          isRoomInBuilding(room.roomCode, scope.building),
        ).length
      }
    }

    const screen = typeof body?.screen === "string" && body.screen.length <= 48 ? body.screen : ""
    const checkoutAt = typeof body?.checkoutAt === "string" && body.checkoutAt.length <= 40 &&
      /\d{1,2}:\d{2}/.test(body.checkoutAt) ? formatDateTimeKorean(body.checkoutAt) : null
    const roomNumber = typeof body?.roomNumber === "string" &&
      getPropertyFromRoomNumber(body.roomNumber) === scope.property &&
      isRoomInBuilding(body.roomNumber, scope.building) ? body.roomNumber.trim() : null

    const answer = assistantAnswer(topic, {
      screen, building: scope.building, availableCount, checkoutAt, roomNumber,
    })
    return NextResponse.json({ topic, answer,
      speechToken: process.env.GEMINI_API_KEY ? createSpeechToken(answer, process.env.GEMINI_API_KEY) : null,
    }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "지금은 AI 답변을 확인하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요." }, { status: 502 })
  }
}

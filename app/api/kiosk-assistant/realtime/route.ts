import { NextResponse } from "next/server"
import { assistantTopics, assistantVoiceStyles } from "@/lib/kiosk-assistant-content"
import { getKioskScope } from "@/lib/kiosk-scope"
import { logAssistantPreview, previewSessionId } from "@/lib/kiosk-assistant-preview-log"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const sessionId = previewSessionId(body?.sessionId)
  try { getKioskScope() } catch {
    logAssistantPreview("missing_scope", { sessionId })
    return NextResponse.json({ error: "키오스크 설정을 확인하지 못했습니다." }, { status: 503 })
  }
  if (!process.env.OPENAI_API_KEY) {
    logAssistantPreview("missing_openai_key", { sessionId })
    return NextResponse.json({ error: "실시간 음성 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const voice = process.env.KIOSK_ASSISTANT_VOICE || "marin"
  const style = process.env.KIOSK_ASSISTANT_VOICE_STYLE || "calm"
  if (!["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"].includes(voice) ||
    !Object.hasOwn(assistantVoiceStyles, style)) {
    return NextResponse.json({ error: "음성 스타일 설정을 확인해 주세요." }, { status: 503 })
  }
  const delivery = assistantVoiceStyles[style as keyof typeof assistantVoiceStyles]
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: {
        // Automatic turns only classify. Audio is requested after verified guidance returns.
        type: "realtime", model: "gpt-realtime-2.1", output_modalities: ["text"],
        instructions: `당신은 숙소 키오스크의 한국어 음성 도우미입니다. ${delivery} 사용자의 말을 듣고 반드시 get_kiosk_guidance로 안내를 조회하세요. 질문을 문맥에 맞게 완전한 한 문장으로 정리하고 주제를 하나 고르세요. 불명확하면 other를 고르세요. 도구가 반환한 answer만 읽고 정보를 추가하거나 추측하지 마세요. 결제, 취소, 환불, 체크인, 키 발급을 실행하거나 성공했다고 주장하지 마세요.`,
        audio: {
          input: { turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true } },
          output: { voice },
        },
        tools: [{ type: "function", name: "get_kiosk_guidance", description: "현재 키오스크의 확인된 안내를 조회합니다. 모든 질문에 먼저 사용합니다.", parameters: {
          type: "object", properties: {
            topic: { type: "string", enum: Object.keys(assistantTopics), description: JSON.stringify(assistantTopics) },
            question: { type: "string", description: "사용자의 질문을 문맥에 맞게 정리한 한국어 문장. 200자 이내." },
          }, required: ["topic", "question"], additionalProperties: false,
        } }], tool_choice: "required", max_output_tokens: 512,
      } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error("Realtime session failed")
    const data = await response.json()
    if (typeof data.value !== "string") throw new Error("Missing client secret")
    logAssistantPreview("session_created", { sessionId, voice, style })
    return NextResponse.json({ value: data.value, delivery }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    logAssistantPreview("session_error", { sessionId })
    return NextResponse.json({ error: "음성 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 })
  }
}

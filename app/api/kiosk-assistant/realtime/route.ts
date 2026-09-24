import { NextResponse } from "next/server"
import { getKioskScope } from "@/lib/kiosk-scope"

export async function POST() {
  let scope
  try { scope = getKioskScope() } catch {
    return NextResponse.json({ error: "키오스크 설정을 확인하지 못했습니다." }, { status: 503 })
  }
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "음성 인식 서비스가 설정되지 않았습니다." }, { status: 503 })

  const silenceMs = Math.min(1800, Math.max(400, Number(process.env.KIOSK_ASSISTANT_SILENCE_MS) || 700))
  const voiceThreshold = Math.min(0.08, Math.max(0.005, Number(process.env.KIOSK_ASSISTANT_VOICE_THRESHOLD) || 0.018))
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": `kiosk-${scope.property}-${scope.building || "all"}`,
      },
      body: JSON.stringify({ session: {
        type: "transcription",
        audio: { input: {
          transcription: {
            model: "gpt-live-transcribe", languages: ["ko"], delay: "low",
            prompt: "한국어 호텔 키오스크에서 손님이 한 말을 받아 적습니다. 실제로 들린 단어만 적고 문장을 풀어 쓰거나 없는 말을 보태지 마세요. 짧은 질문은 짧게 유지하세요.",
          },
          turn_detection: null,
        } },
      } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error("OpenAI transcription session failed")
    const data = await response.json()
    if (typeof data.value !== "string") throw new Error("Missing client secret")
    return NextResponse.json({ value: data.value, silenceMs, voiceThreshold }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "음성 인식을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 })
  }
}

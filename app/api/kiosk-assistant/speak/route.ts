import { NextResponse } from "next/server"
import { verifySpeechToken } from "@/lib/kiosk-assistant-speech"
import { assistantVoiceStyles } from "@/lib/kiosk-assistant-content"

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "음성 안내 서비스가 설정되지 않았습니다." }, { status: 503 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: "안내 문장을 확인해 주세요." }, { status: 400 }) }
  const text = typeof (body as { text?: unknown } | null)?.text === "string" ? (body as { text: string }).text.trim() : ""
  const token = typeof (body as { token?: unknown } | null)?.token === "string" ? (body as { token: string }).token : ""
  if (!text || text.length > 500 || !verifySpeechToken(text, token, process.env.GEMINI_API_KEY)) {
    return NextResponse.json({ error: "안내 문장을 확인해 주세요." }, { status: 400 })
  }

  try {
    const style = process.env.KIOSK_ASSISTANT_VOICE_STYLE || "calm"
    const delivery = Object.hasOwn(assistantVoiceStyles, style) ? assistantVoiceStyles[style as keyof typeof assistantVoiceStyles] : assistantVoiceStyles.calm
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text, speech_metadata: { style: delivery } }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: "Kore" } } },
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error("Speech request failed")
    const result = await response.json()
    const encoded = result?.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string } }) => part.inlineData?.data)?.inlineData?.data
    if (typeof encoded !== "string") throw new Error("No audio returned")
    const audio = Buffer.from(encoded, "base64")
    if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF") throw new Error("Invalid WAV response")
    return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "음성 안내를 재생하지 못했습니다. 화면의 글을 확인해 주세요." }, { status: 502 })
  }
}

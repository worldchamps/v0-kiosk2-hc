import { NextResponse } from "next/server"

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "음성 인식 서비스가 설정되지 않았습니다." }, { status: 503 })
  if (Number(request.headers.get("content-length") || 0) > 8_000_000) return NextResponse.json({ error: "녹음이 너무 깁니다." }, { status: 413 })

  try {
    const form = await request.formData()
    const audio = form.get("audio")
    if (!(audio instanceof File) || audio.size === 0 || audio.size > 5_000_000 ||
      !/^(audio\/(webm|wav|ogg|mp4|mpeg|mp3)|video\/webm)/.test(audio.type)) {
      return NextResponse.json({ error: "녹음 파일을 확인해 주세요." }, { status: 400 })
    }
    const upstream = new FormData()
    upstream.append("file", audio, audio.name)
    upstream.append("model", "gpt-transcribe")
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: upstream, signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error("Transcription request failed")
    const result = await response.json()
    const text = typeof result.text === "string" ? result.text.trim().slice(0, 200) : ""
    if (!text) throw new Error("Empty transcription")
    return NextResponse.json({ text }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "음성을 알아듣지 못했습니다. 다시 말하거나 글자로 입력해 주세요." }, { status: 502 })
  }
}

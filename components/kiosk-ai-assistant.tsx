"use client"

import { useEffect, useRef, useState } from "react"
import { MessageCircleQuestion, Mic, Send, X } from "lucide-react"
import { suggestedQuestions } from "@/lib/kiosk-assistant-content"
import { useKioskRealtimeVoice } from "@/hooks/use-kiosk-realtime-voice"

interface KioskAiAssistantProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  screen: string
  roomNumber?: string
  checkoutAt?: string
}

export default function KioskAiAssistant({ open, onOpenChange, screen, roomNumber, checkoutAt }: KioskAiAssistantProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const [input, setInput] = useState("")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [speechToken, setSpeechToken] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const voice = useKioskRealtimeVoice({
    screen, roomNumber, checkoutAt,
    onQuestion: value => { setQuestion(value); setSpeechToken("") },
    onAnswer: setAnswer,
    onError: setError,
  })
  const voiceStatus = { idle: "버튼을 누른 뒤 편하게 말씀하세요.", connecting: "마이크를 연결하고 있어요…", listening: "듣고 있어요. 말씀해 주세요.", thinking: "안내를 확인하고 있어요…", speaking: "말하는 중이에요. 중간에 질문해도 괜찮아요." }[voice.phase]

  const stopAudio = () => {
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    setSpeaking(false)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (open) return
    requestRef.current?.abort()
    voice.stop()
    stopAudio()
    setBusy(false)
    setQuestion("")
    setAnswer("")
    setSpeechToken("")
    setInput("")
    setError("")
  }, [open, voice.stop])

  const speak = async (text: string, token: string) => {
    if (!token) return
    stopAudio()
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await fetch("/api/kiosk-assistant/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, token }), signal: controller.signal,
      })
      if (!response.ok) throw new Error("음성 안내를 재생하지 못했습니다. 화면의 글을 확인해 주세요.")
      const blob = await response.blob()
      if (controller.signal.aborted || requestRef.current !== controller) return
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = stopAudio
      await audio.play()
      if (controller.signal.aborted || requestRef.current !== controller) { audio.pause(); return }
      setSpeaking(true)
    } catch (cause) {
      if (!controller.signal.aborted && requestRef.current === controller) setError(cause instanceof Error ? cause.message : "음성 안내를 재생하지 못했습니다.")
    }
  }

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy || voice.active) return
    requestRef.current?.abort()
    stopAudio()
    setQuestion(trimmed)
    setAnswer("")
    setSpeechToken("")
    setError("")
    setBusy(true)
    setInput("")
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await fetch("/api/kiosk-assistant/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, screen, roomNumber, checkoutAt, sessionId: crypto.randomUUID() }), signal: controller.signal,
      })
      const result = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok || typeof result.answer !== "string") throw new Error(result.error || "답변을 확인하지 못했습니다.")
      setAnswer(result.answer)
      setSpeechToken(typeof result.speechToken === "string" ? result.speechToken : "")
      if (result.speechToken) void speak(result.answer, result.speechToken)
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "답변을 확인하지 못했습니다.")
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const toggleVoice = () => {
    if (voice.active) { voice.stop(); return }
    requestRef.current?.abort()
    stopAudio()
    setBusy(false)
    setQuestion("")
    setAnswer("")
    setSpeechToken("")
    void voice.start()
  }

  return <>
    <button type="button" className="kiosk-ai-launcher" aria-label="AI 도우미 열기" onClick={() => onOpenChange(true)}>
      <MessageCircleQuestion aria-hidden="true" /><span>AI 도우미</span>
    </button>
    <dialog ref={dialogRef} className="kiosk-ai-panel" aria-labelledby="kiosk-ai-title" onClose={() => onOpenChange(false)}>
      <div className="kiosk-ai-head">
        <div><h2 id="kiosk-ai-title">AI 도우미</h2><p>음성으로 대화하거나 글자로 물어보세요.</p></div>
        <button type="button" aria-label="AI 도우미 닫기" onClick={() => onOpenChange(false)}><X aria-hidden="true" /></button>
      </div>
      <div className="kiosk-ai-body" aria-live="polite">
        <div className="kiosk-ai-voice" data-phase={voice.phase}>
          <button type="button" aria-pressed={voice.active} onClick={toggleVoice}>
            <Mic aria-hidden="true" /><span>{voice.active ? "음성 대화 끝내기" : "음성 대화 시작"}</span>
          </button>
          <p role="status">{voiceStatus}</p>
        </div>
        {!question && !voice.active && <>
          <p className="kiosk-ai-prompt">지금 무엇이 궁금하세요?</p>
          <div className="kiosk-ai-suggestions">{suggestedQuestions(screen).map(item =>
            <button type="button" key={item} disabled={busy} onClick={() => void ask(item)}>{item}</button>)}</div>
        </>}
        {question && <p className="kiosk-ai-question"><strong>질문</strong><span>{question}</span></p>}
        {busy && <p role="status">답변을 확인하고 있습니다…</p>}
        {(answer || voice.caption) && <div className="kiosk-ai-answer"><strong>안내</strong><p>{voice.active && voice.caption ? voice.caption : answer}</p>
          {speechToken && <button type="button" disabled={speaking} onClick={() => void speak(answer, speechToken)}>{speaking ? "읽는 중" : "답변 다시 듣기"}</button>}
        </div>}
        {error && <p className="kiosk-ai-error" role="alert">{error}</p>}
      </div>
      <form className="kiosk-ai-input" onSubmit={event => { event.preventDefault(); void ask(input) }}>
        <input ref={inputRef} aria-label="AI 도우미에게 질문" disabled={voice.active} maxLength={200} value={input} onChange={event => setInput(event.target.value)} placeholder={voice.active ? "음성 대화 중입니다" : "예: 객실이 있나요?"} />
        <button type="submit" aria-label="질문 보내기" disabled={busy || voice.active || !input.trim()}><Send aria-hidden="true" /></button>
      </form>
      <p className="kiosk-ai-note">음성 대화 중에는 마이크 소리가 OpenAI로 전송됩니다. 대화는 3분 뒤 자동 종료됩니다.
        {process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" && " 미리보기에서는 질문과 안내 문구가 테스트 로그에 기록됩니다."}</p>
    </dialog>
  </>
}

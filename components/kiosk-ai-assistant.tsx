"use client"

import { useEffect, useRef, useState } from "react"
import { MessageCircleQuestion, Mic, Send, X } from "lucide-react"
import { suggestedQuestions } from "@/lib/kiosk-assistant-content"

interface KioskAiAssistantProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  screen: string
  roomNumber?: string
  checkoutAt?: string
}

export default function KioskAiAssistant({ open, onOpenChange, screen, roomNumber, checkoutAt }: KioskAiAssistantProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  openRef.current = open
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const [input, setInput] = useState("")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [speechToken, setSpeechToken] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [speaking, setSpeaking] = useState(false)

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
    recorderRef.current && (recorderRef.current.onstop = null)
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
    recorderRef.current = null
    streamRef.current = null
    stopAudio()
    setRecording(false)
    setBusy(false)
    setQuestion("")
    setAnswer("")
    setSpeechToken("")
    setInput("")
    setError("")
  }, [open])

  const speak = async (text: string, token: string) => {
    if (!token) return
    stopAudio()
    try {
      const controller = new AbortController()
      requestRef.current = controller
      const response = await fetch("/api/kiosk-assistant/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, token }), signal: controller.signal,
      })
      if (!response.ok) throw new Error("음성 안내를 재생하지 못했습니다. 화면의 글을 확인해 주세요.")
      const url = URL.createObjectURL(await response.blob())
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = stopAudio
      await audio.play()
      setSpeaking(true)
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "음성 안내를 재생하지 못했습니다.")
    }
  }

  const ask = async (text: string, fromRecording = false) => {
    const trimmed = text.trim()
    if (!trimmed || (busy && !fromRecording)) return
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
        body: JSON.stringify({ question: trimmed, screen, roomNumber, checkoutAt }), signal: controller.signal,
      })
      const result = await response.json()
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

  const stopRecording = () => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
  }

  const toggleRecording = async () => {
    if (recording) { stopRecording(); return }
    if (busy) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("이 기기에서는 마이크를 사용할 수 없습니다. 글자로 질문해 주세요.")
      return
    }
    try {
      setError("")
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!openRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : ""
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setRecording(false)
        if (!chunks.length) { setError("음성을 듣지 못했습니다. 다시 말해 주세요."); return }
        const controller = new AbortController()
        requestRef.current = controller
        setBusy(true)
        try {
          const form = new FormData()
          const format = recorder.mimeType.includes("mp4") ? "mp4" : recorder.mimeType.includes("ogg") ? "ogg" : "webm"
          form.append("audio", new File(chunks, `question.${format}`, { type: recorder.mimeType || "audio/webm" }))
          const response = await fetch("/api/kiosk-assistant/transcribe", { method: "POST", body: form, signal: controller.signal })
          const result = await response.json()
          if (!response.ok || typeof result.text !== "string") throw new Error(result.error || "음성을 알아듣지 못했습니다.")
          void ask(result.text, true)
        } catch (cause) {
          if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "음성을 알아듣지 못했습니다.")
          setBusy(false)
        }
      }
      recorder.start()
      setRecording(true)
      recordingTimerRef.current = setTimeout(stopRecording, 15000)
    } catch {
      streamRef.current?.getTracks().forEach(track => track.stop())
      setError("마이크를 사용할 수 없습니다. 권한을 확인하거나 글자로 질문해 주세요.")
    }
  }

  return <>
    <button type="button" className="kiosk-ai-launcher" aria-label="AI 도우미 열기" onClick={() => onOpenChange(true)}>
      <MessageCircleQuestion aria-hidden="true" /><span>AI 도우미</span>
    </button>
    <dialog ref={dialogRef} className="kiosk-ai-panel" aria-labelledby="kiosk-ai-title" onClose={() => onOpenChange(false)}>
      <div className="kiosk-ai-head">
        <div><h2 id="kiosk-ai-title">AI 도우미</h2><p>궁금한 점을 말하거나 글자로 입력해 주세요.</p></div>
        <button type="button" aria-label="AI 도우미 닫기" onClick={() => onOpenChange(false)}><X aria-hidden="true" /></button>
      </div>
      <div className="kiosk-ai-body" aria-live="polite">
        {!question && <>
          <p className="kiosk-ai-prompt">지금 무엇이 궁금하세요?</p>
          <div className="kiosk-ai-suggestions">{suggestedQuestions(screen).map(item =>
            <button type="button" key={item} disabled={busy} onClick={() => void ask(item)}>{item}</button>)}</div>
        </>}
        {question && <p className="kiosk-ai-question"><strong>질문</strong><span>{question}</span></p>}
        {busy && <p role="status">답변을 확인하고 있습니다…</p>}
        {answer && <div className="kiosk-ai-answer"><strong>안내</strong><p>{answer}</p>
          {speechToken && <button type="button" disabled={speaking} onClick={() => void speak(answer, speechToken)}>{speaking ? "읽는 중" : "답변 다시 듣기"}</button>}
        </div>}
        {error && <p className="kiosk-ai-error" role="alert">{error}</p>}
      </div>
      <form className="kiosk-ai-input" onSubmit={event => { event.preventDefault(); void ask(input) }}>
        <input ref={inputRef} aria-label="AI 도우미에게 질문" maxLength={200} value={input} onChange={event => setInput(event.target.value)} placeholder="예: 객실이 있나요?" />
        <button type="submit" aria-label="질문 보내기" disabled={busy || recording || !input.trim()}><Send aria-hidden="true" /></button>
        <button type="button" aria-label={recording ? "녹음 끝내기" : "음성으로 질문하기"} aria-pressed={recording} disabled={busy} onClick={() => void toggleRecording()}><Mic aria-hidden="true" /></button>
      </form>
      <p className="kiosk-ai-note">마이크를 누르면 질문 음성이 AI 서비스로 전송됩니다. 답변이 어려우면 관리자에게 문의해 주세요.</p>
    </dialog>
  </>
}

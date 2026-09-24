"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, CalendarDays, CreditCard, Info, KeyRound, MapPin, Mic, Pencil, Phone, Search, Send, UserRound, X } from "lucide-react"
import { suggestedQuestions } from "@/lib/kiosk-assistant-content"
import { readAssistantStream } from "@/lib/kiosk-assistant-stream"
import { useKioskRealtimeVoice } from "@/hooks/use-kiosk-realtime-voice"

interface KioskAiAssistantProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  screen: string
  roomNumber?: string
  checkoutAt?: string
}

type ChatTurn = { question: string; answer: string; source: "voice" | "text" }

function QuestionIcon({ text }: { text: string }) {
  if (/객실|방/.test(text)) return <Search aria-hidden="true" />
  if (/결제|계좌/.test(text)) return <CreditCard aria-hidden="true" />
  if (/키|출입/.test(text)) return <KeyRound aria-hidden="true" />
  if (/어디/.test(text)) return <MapPin aria-hidden="true" />
  return <CalendarDays aria-hidden="true" />
}

export default function KioskAiAssistant({ open, onOpenChange, screen, roomNumber, checkoutAt }: KioskAiAssistantProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const currentTurnRef = useRef<ChatTurn>({ question: "", answer: "", source: "text" })
  const [input, setInput] = useState("")
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [speechToken, setSpeechToken] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const saveTurn = () => {
    const previous = currentTurnRef.current
    if (previous.question) setHistory(items => [...items, previous])
    currentTurnRef.current = { question: "", answer: "", source: "text" }
    setQuestion("")
    setAnswer("")
  }
  const voice = useKioskRealtimeVoice({
    screen,
    onQuestion: value => {
      if (!value) { saveTurn(); return }
      currentTurnRef.current = { ...currentTurnRef.current, question: value, source: "voice" }
      setQuestion(value)
      setSpeechToken("")
    },
    onAnswer: value => {
      if (!value) return
      currentTurnRef.current = { ...currentTurnRef.current, answer: value }
      setAnswer(value)
    },
    onError: setError,
  })
  const voiceStatus = { idle: "버튼을 누른 뒤 편하게 말씀하세요.", connecting: "마이크를 연결하고 있어요…", listening: "듣고 있어요. 말씀해 주세요.", thinking: "안내를 확인하고 있어요…", speaking: "말하는 중이에요. 안내가 끝난 뒤 질문해 주세요." }[voice.phase]
  const waiting = busy || voice.phase === "thinking"

  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: "nearest" }) }, [history, question, answer, error, busy])

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
    setHistory([])
    currentTurnRef.current = { question: "", answer: "", source: "text" }
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
    saveTurn()
    currentTurnRef.current = { question: trimmed, answer: "", source: "text" }
    setQuestion(trimmed)
    setSpeechToken("")
    setError("")
    setBusy(true)
    setInput("")
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await fetch("/api/kiosk-assistant/ask", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ question: trimmed, screen, roomNumber, checkoutAt }), signal: controller.signal,
      })
      const result = await readAssistantStream(response, chunk => {
        if (controller.signal.aborted || requestRef.current !== controller) return
        currentTurnRef.current = { ...currentTurnRef.current, answer: currentTurnRef.current.answer + chunk }
        setAnswer(currentTurnRef.current.answer)
      })
      if (controller.signal.aborted) return
      setSpeechToken(typeof result.speechToken === "string" ? result.speechToken : "")
      if (result.speechToken) void speak(currentTurnRef.current.answer, result.speechToken)
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        currentTurnRef.current = { ...currentTurnRef.current, answer: "" }
        setAnswer("")
        setError(cause instanceof Error ? cause.message : "답변을 확인하지 못했습니다.")
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const toggleVoice = () => {
    if (voice.active) { voice.stop(); return }
    requestRef.current?.abort()
    stopAudio()
    setBusy(false)
    saveTurn()
    setSpeechToken("")
    void voice.start()
  }

  return <>
    <button type="button" className="kiosk-ai-launcher" aria-label="AI 도우미 열기" onClick={() => onOpenChange(true)}>
      <Bot aria-hidden="true" /><span>AI 도우미</span>
    </button>
    <dialog ref={dialogRef} className="kiosk-ai-panel" aria-labelledby="kiosk-ai-title" onClose={() => onOpenChange(false)}>
      <div className="kiosk-ai-head">
        <div><h2 id="kiosk-ai-title">AI 도우미</h2><p>음성 또는 터치로 빠르게 안내해드려요.</p></div>
        <button type="button" aria-label="AI 도우미 닫기" onClick={() => onOpenChange(false)}><X aria-hidden="true" /></button>
      </div>
      <div className="kiosk-ai-body" aria-live="polite">
        <div className="kiosk-ai-voice" data-phase={voice.phase}>
          <button type="button" aria-pressed={voice.active} onClick={toggleVoice}>
            <Mic aria-hidden="true" /><span>{voice.active ? "음성 안내 종료" : "음성 안내 시작"}</span>
          </button>
          <p role="status">{voiceStatus}</p>
        </div>
        <div className="kiosk-ai-shortcuts">
          <div className="kiosk-ai-shortcuts-head">
            <h3>자주 묻는 질문</h3>
            <a href="tel:01051264644"><Phone aria-hidden="true" />직원 문의 <strong>010-5126-4644</strong></a>
          </div>
          <div className="kiosk-ai-suggestions">{suggestedQuestions(screen).map(item =>
            <button type="button" key={item} disabled={busy || voice.active} onClick={() => void ask(item)}><QuestionIcon text={item} /><span>{item}</span></button>)}</div>
        </div>
        <div className="kiosk-ai-thread" role="log" aria-label="AI 도우미 대화">
          {!question && history.length === 0 && !waiting && <div className="kiosk-ai-empty"><Bot aria-hidden="true" /><p>궁금한 내용을 누르거나 직접 물어보세요.</p></div>}
          {history.map((turn, index) => <div className="kiosk-ai-turn" key={index}>
            <div className="kiosk-ai-message kiosk-ai-message-user"><p className="kiosk-ai-question"><strong>{turn.source === "voice" ? "음성 인식 결과" : "질문"}</strong><span>{turn.question}</span></p><UserRound aria-hidden="true" /></div>
            {turn.answer && <div className="kiosk-ai-message kiosk-ai-message-bot"><Bot aria-hidden="true" /><div className="kiosk-ai-answer"><strong>안내</strong><p>{turn.answer}</p></div></div>}
          </div>)}
          {question && <div className="kiosk-ai-turn">
            <div className="kiosk-ai-message kiosk-ai-message-user"><p className="kiosk-ai-question"><strong>{currentTurnRef.current.source === "voice" ? (voice.phase === "listening" && !answer ? "듣고 있는 말" : "음성 인식 결과") : "질문"}</strong><span>{question}</span></p><UserRound aria-hidden="true" /></div>
            {(answer || voice.caption) && <div className="kiosk-ai-message kiosk-ai-message-bot"><Bot aria-hidden="true" /><div className="kiosk-ai-answer"><strong>안내</strong><p>{voice.active && voice.caption ? voice.caption : answer}</p>
              {voice.active && voice.canReplay && <button type="button" disabled={voice.phase === "speaking"} onClick={() => void voice.replay()}>답변 다시 듣기</button>}
              {!voice.active && speechToken && <button type="button" onClick={() => speaking ? stopAudio() : void speak(answer, speechToken)}>{speaking ? "음성 중단" : "답변 다시 듣기"}</button>}
            </div></div>}
          </div>}
          {waiting && !answer && !voice.caption && <div className="kiosk-ai-message kiosk-ai-message-bot"><Bot aria-hidden="true" /><p className="kiosk-ai-progress" role="status"><span className="kiosk-ai-dots" aria-hidden="true"><i /><i /><i /></span>안내를 준비하고 있어요…</p></div>}
          <div ref={chatEndRef} />
        </div>
        {/직원에게 연락/.test(answer) && <p className="kiosk-ai-staff-contact">직원 연락: 010-5126-4644</p>}
        {error && <div className="kiosk-ai-error" role="alert"><p>{error}</p><div>
          {/음성|마이크|질문을 잘 듣/.test(error) && <button type="button" onClick={() => { setError(""); if (voice.active) voice.stop(); void voice.start() }}>다시 말씀하기</button>}
          <a href="tel:01051264644"><Phone aria-hidden="true" />직원 문의 010-5126-4644</a>
        </div></div>}
      </div>
      <form className="kiosk-ai-input" onSubmit={event => { event.preventDefault(); void ask(input) }}>
        <Pencil aria-hidden="true" /><input ref={inputRef} aria-label="AI 도우미에게 질문" disabled={voice.active} maxLength={200} value={input} onChange={event => setInput(event.target.value)} placeholder={voice.active ? "음성 대화 중입니다" : "궁금한 내용을 입력하세요"} />
        <button type="submit" aria-label="질문 보내기" disabled={busy || voice.active || !input.trim()}><Send aria-hidden="true" /></button>
      </form>
      <p className="kiosk-ai-note"><Info aria-hidden="true" />개인정보나 민감한 정보는 입력하지 마세요. 음성 안내를 시작하면 마이크 소리가 OpenAI 음성 인식으로 전송되며, 대화는 3분 뒤 자동 종료됩니다.</p>
    </dialog>
  </>
}

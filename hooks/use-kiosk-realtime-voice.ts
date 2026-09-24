"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { parseGuidanceCall } from "@/lib/kiosk-assistant-content"

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking"
interface VoiceOptions {
  screen: string
  roomNumber?: string
  checkoutAt?: string
  onQuestion: (question: string) => void
  onAnswer: (answer: string) => void
  onError: (error: string) => void
}

export function useKioskRealtimeVoice(options: VoiceOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const sessionRef = useRef<AbortController | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  const [caption, setCaption] = useState("")

  const stop = useCallback(() => {
    sessionRef.current?.abort()
    sessionRef.current = null
    channelRef.current?.close()
    channelRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null }
    audioRef.current = null
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setPhase("idle")
    setCaption("")
  }, [])

  useEffect(() => stop, [stop])

  const start = async () => {
    if (sessionRef.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      optionsRef.current.onError("음성 대화는 HTTPS 또는 이 PC의 localhost 주소에서 열어 주세요.")
      return
    }
    const controller = new AbortController()
    sessionRef.current = controller
    const current = () => sessionRef.current === controller && !controller.signal.aborted
    setPhase("connecting")
    setCaption("")
    optionsRef.current.onError("")
    let turn = 0
    const responseTurns = new Map<string, number>()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const tokenResponse = await fetch("/api/kiosk-assistant/realtime", {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      })
      const token = await tokenResponse.json()
      if (!tokenResponse.ok || typeof token.value !== "string") throw new Error(token.error || "음성 연결을 시작하지 못했습니다.")
      if (!current()) return

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      timerRef.current = setTimeout(() => {
        if (!current()) return
        stop()
        optionsRef.current.onError("음성 연결 시간이 초과되었습니다. 다시 시작해 주세요.")
      }, 30000)
      const audio = new Audio()
      audio.autoplay = true
      audioRef.current = audio
      pc.ontrack = event => {
        if (!current()) return
        audio.srcObject = event.streams[0]
        void audio.play().catch(() => {
          if (current()) optionsRef.current.onError("음성 재생이 차단되었습니다. 브라우저의 소리 설정을 확인해 주세요.")
        })
      }
      pc.onconnectionstatechange = () => {
        if (current() && ["failed", "disconnected"].includes(pc.connectionState)) {
          stop()
          optionsRef.current.onError("음성 연결이 끊겼습니다. 다시 시작해 주세요.")
        }
      }
      stream.getTracks().forEach(track => pc.addTrack(track, stream))
      const dc = pc.createDataChannel("oai-events")
      channelRef.current = dc
      const send = (event: unknown) => { if (current() && dc.readyState === "open") dc.send(JSON.stringify(event)) }

      const answerCall = async (item: unknown, inputTurn: number) => {
        const call = parseGuidanceCall(item)
        if (!call) { stop(); optionsRef.current.onError("질문을 확인하지 못했습니다. 음성 대화를 다시 시작해 주세요."); return }
        if (inputTurn !== turn) {
          send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.callId, output: "새 질문으로 대체되었습니다." } })
          return
        }
        setPhase("thinking")
        optionsRef.current.onQuestion(call.question)
        let answer = "지금은 안내를 확인하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요."
        try {
          const { screen, roomNumber, checkoutAt } = optionsRef.current
          const response = await fetch("/api/kiosk-assistant/ask", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: call.question, topic: call.topic, screen, roomNumber, checkoutAt }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          })
          const result = await response.json()
          if (response.ok && typeof result.answer === "string") answer = result.answer
        } catch { if (!current()) return }
        if (!current()) return
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify({ answer }) } })
        // A newer utterance supersedes this lookup; never speak its stale result.
        if (inputTurn !== turn) return
        optionsRef.current.onAnswer(answer)
        setCaption("")
        send({ type: "response.create", response: {
          tool_choice: "none", output_modalities: ["audio"], input: [],
          instructions: `${token.delivery} 다음 승인된 안내 문장만 한국어로 그대로 읽으세요. 설명이나 인사를 추가하지 마세요. 안내: ${answer}`,
        } })
      }

      dc.onopen = () => {
        if (!current()) return
        if (timerRef.current) clearTimeout(timerRef.current)
        setPhase("listening")
        // Public kiosk sessions end even when someone leaves the dialog open.
        timerRef.current = setTimeout(() => {
          if (!current()) return
          stop()
          optionsRef.current.onError("음성 대화가 종료되었습니다. 더 궁금한 점이 있으면 다시 시작해 주세요.")
        }, 180000)
      }
      dc.onmessage = event => {
        if (!current()) return
        let data
        try { data = JSON.parse(event.data) } catch { return }
        if (data.type === "response.created" && typeof data.response?.id === "string") responseTurns.set(data.response.id, turn)
        else if (data.type === "input_audio_buffer.speech_started") {
          turn++
          setCaption("")
          optionsRef.current.onQuestion("")
          optionsRef.current.onAnswer("")
          setPhase("listening")
        } else if (data.type === "input_audio_buffer.speech_stopped") setPhase("thinking")
        else if (data.type === "output_audio_buffer.started") setPhase("speaking")
        else if (["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(data.type)) setPhase(value => value === "speaking" ? "listening" : value)
        else if (data.type === "response.output_audio_transcript.delta" && typeof data.delta === "string" && responseTurns.get(data.response_id) === turn) setCaption(value => (value + data.delta).slice(0, 2000))
        else if (data.type === "response.done" && data.response?.status === "completed") {
          const inputTurn = responseTurns.get(data.response.id)
          responseTurns.delete(data.response.id)
          const calls = (Array.isArray(data.response.output) ? data.response.output : []).filter((item: { type?: string }) => item?.type === "function_call")
          if (calls.length === 1 && inputTurn !== undefined) void answerCall(calls[0], inputTurn)
          else if (calls.length > 1) { stop(); optionsRef.current.onError("음성 대화를 다시 시작하고 한 가지씩 물어봐 주세요.") }
        } else if (data.type === "error" || (data.type === "response.done" && ["failed", "incomplete"].includes(data.response?.status))) {
          stop()
          optionsRef.current.onError("음성 안내 중 오류가 발생했습니다. 다시 시작하거나 글자로 질문해 주세요.")
        } else if (data.type === "response.done") responseTurns.delete(data.response?.id)
      }
      dc.onclose = () => { if (current()) stop() }
      dc.onerror = () => {
        if (!current()) return
        stop()
        optionsRef.current.onError("음성 연결이 끊겼습니다. 다시 시작해 주세요.")
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
        body: offer.sdp, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      })
      if (!response.ok) throw new Error("실시간 음성 연결에 실패했습니다. 다시 시작해 주세요.")
      const sdp = await response.text()
      if (current()) await pc.setRemoteDescription({ type: "answer", sdp })
    } catch (error) {
      if (!current()) return
      stop()
      optionsRef.current.onError((error as Error).name === "NotAllowedError"
        ? "마이크 권한을 허용한 뒤 음성 대화를 다시 시작해 주세요."
        : error instanceof Error ? error.message : "마이크 연결을 확인해 주세요.")
    }
  }

  return { phase, caption, active: phase !== "idle", start, stop }
}

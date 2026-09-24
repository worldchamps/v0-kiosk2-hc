"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { readAssistantStream } from "@/lib/kiosk-assistant-stream"

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking"
interface VoiceOptions {
  screen: string
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
  const contextRef = useRef<AudioContext | null>(null)
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const speechRef = useRef<{ text: string; token: string } | null>(null)
  const resumeRef = useRef<() => void>(() => {})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  const [caption, setCaption] = useState("")

  const stop = useCallback(() => {
    sessionRef.current?.abort()
    sessionRef.current = null
    if (meterRef.current) clearInterval(meterRef.current)
    meterRef.current = null
    void contextRef.current?.close()
    contextRef.current = null
    channelRef.current?.close()
    channelRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    speechRef.current = null
    resumeRef.current = () => {}
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setPhase("idle")
    setCaption("")
  }, [])

  useEffect(() => stop, [stop])

  const replay = async () => {
    const speech = speechRef.current
    const controller = sessionRef.current
    if (!speech || !controller || controller.signal.aborted) return
    const microphone = streamRef.current?.getAudioTracks()[0]
    if (microphone) microphone.enabled = false
    audioRef.current?.pause()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    setPhase("speaking")
    try {
      const response = await fetch("/api/kiosk-assistant/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(speech),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      })
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      if (sessionRef.current !== controller || controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        if (audioUrlRef.current === url) audioUrlRef.current = null
        audioRef.current = null
        resumeRef.current()
      }
      await audio.play()
    } catch {
      if (sessionRef.current === controller && !controller.signal.aborted) {
        optionsRef.current.onError("음성 안내를 재생하지 못했습니다. 화면의 글을 확인해 주세요.")
        resumeRef.current()
      }
    }
  }

  const start = async () => {
    if (sessionRef.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined" || typeof AudioContext === "undefined") {
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
    let completedTurn = 0
    let partial = ""
    let hearing = false
    let committed = false
    let lastVoiceAt = 0
    let voiceStartedAt = 0
    let failedQuestions = 0

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const microphone = stream.getAudioTracks()[0]
      const context = new AudioContext()
      contextRef.current = context
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      await context.resume()
      const samples = new Uint8Array(analyser.fftSize)

      const tokenResponse = await fetch("/api/kiosk-assistant/realtime", {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      })
      const token = await tokenResponse.json()
      if (!tokenResponse.ok || typeof token.value !== "string") throw new Error(token.error || "음성 연결을 시작하지 못했습니다.")
      if (!current()) return
      const silenceMs = typeof token.silenceMs === "number" ? token.silenceMs : 700
      const threshold = typeof token.voiceThreshold === "number" ? token.voiceThreshold : 0.018

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      timerRef.current = setTimeout(() => {
        if (!current()) return
        stop()
        optionsRef.current.onError("음성 연결 시간이 초과되었습니다. 다시 시작해 주세요.")
      }, 30000)
      pc.onconnectionstatechange = () => {
        if (current() && ["failed", "disconnected"].includes(pc.connectionState)) {
          stop()
          optionsRef.current.onError("음성 연결이 끊겼습니다. 다시 시작해 주세요.")
        }
      }
      pc.addTrack(microphone, stream)
      const dc = pc.createDataChannel("oai-events")
      channelRef.current = dc

      const listenAgain = () => {
        if (!current()) return
        committed = false
        microphone.enabled = true
        setPhase("listening")
      }
      resumeRef.current = listenAgain
      const answerQuestion = async (question: string, inputTurn: number) => {
        const cleanQuestion = question.trim()
        if (!cleanQuestion) {
          failedQuestions++
          if (failedQuestions >= 2) {
            optionsRef.current.onAnswer("질문을 알아듣지 못했습니다. 직원에게 연락해 주세요.")
            stop()
            return
          }
          optionsRef.current.onError("질문을 잘 듣지 못했습니다. 다시 한 번 말씀해 주세요.")
          listenAgain()
          return
        }
        setPhase("thinking")
        optionsRef.current.onQuestion(cleanQuestion)
        let answer = "지금은 안내를 확인하지 못했습니다. 직원에게 연락해 주세요."
        let speechToken = ""
        try {
          const response = await fetch("/api/kiosk-assistant/ask", {
            method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
            body: JSON.stringify({ question: cleanQuestion, screen: optionsRef.current.screen }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          })
          answer = ""
          const result = await readAssistantStream(response, chunk => {
            if (!current() || inputTurn !== turn) return
            answer += chunk
            optionsRef.current.onAnswer(answer)
            setCaption(answer)
          })
          if (typeof result.speechToken === "string") speechToken = result.speechToken
          if (result.topic === "other") {
            failedQuestions++
            if (failedQuestions >= 2) {
              answer = "질문을 확인하지 못했습니다. 직원에게 연락해 주세요."
              speechToken = ""
            }
          } else failedQuestions = 0
        } catch {
          if (!current()) return
          answer = "지금은 안내를 확인하지 못했습니다. 직원에게 연락해 주세요."
          speechToken = ""
        }
        if (!current() || inputTurn !== turn) return
        optionsRef.current.onAnswer(answer)
        setCaption(answer)
        if (failedQuestions >= 2) { stop(); return }
        if (!speechToken) { listenAgain(); return }
        speechRef.current = { text: answer, token: speechToken }
        await replay()
      }

      dc.onopen = () => {
        if (!current()) return
        if (timerRef.current) clearTimeout(timerRef.current)
        setPhase("listening")
        timerRef.current = setTimeout(() => {
          if (!current()) return
          stop()
          optionsRef.current.onError("음성 대화가 종료되었습니다. 더 궁금한 점이 있으면 다시 시작해 주세요.")
        }, 180000)
        meterRef.current = setInterval(() => {
          if (!current() || dc.readyState !== "open" || committed) return
          analyser.getByteTimeDomainData(samples)
          let energy = 0
          for (const sample of samples) energy += ((sample - 128) / 128) ** 2
          const now = Date.now()
          if (Math.sqrt(energy / samples.length) >= threshold) {
            lastVoiceAt = now
            if (!hearing) {
              hearing = true
              voiceStartedAt = now
              turn++
              partial = ""
              speechRef.current = null
              setCaption("")
              optionsRef.current.onQuestion("")
              optionsRef.current.onAnswer("")
              optionsRef.current.onError("")
            }
          } else if (hearing && now - lastVoiceAt >= silenceMs && now - voiceStartedAt >= 300) {
            hearing = false
            committed = true
            microphone.enabled = false
            dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }))
            setPhase("thinking")
          }
        }, 50)
      }
      dc.onmessage = event => {
        if (!current()) return
        let data
        try { data = JSON.parse(event.data) } catch { return }
        if (data.type === "conversation.item.input_audio_transcription.delta" && typeof data.delta === "string") {
          partial = (partial + data.delta).slice(0, 200)
          optionsRef.current.onQuestion(partial)
        } else if (data.type === "conversation.item.input_audio_transcription.completed" && committed && completedTurn !== turn) {
          completedTurn = turn
          void answerQuestion(typeof data.transcript === "string" ? data.transcript : partial, turn)
        } else if (data.type === "error" || data.type === "conversation.item.input_audio_transcription.failed") {
          optionsRef.current.onError("음성을 알아듣지 못했습니다. 다시 한 번 말씀해 주세요.")
          listenAgain()
        }
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

  return { phase, caption, active: phase !== "idle", start, stop, replay, canReplay: !!speechRef.current }
}

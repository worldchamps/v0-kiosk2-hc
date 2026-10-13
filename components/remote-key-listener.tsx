"use client"

import { useEffect, useRef, useState } from "react"
import { autoConnectPrinter, printRoomInfoReceipt } from "@/lib/printer-utils"
import { cardFailure } from "@/lib/check-in-card"
import CheckInCardProgress from "@/components/check-in-card-progress"

async function requestJob(id: string, action: string, details = {}) {
  const response = await fetch("/api/remote-key", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action, ...details }), signal: AbortSignal.timeout(15000) })
  const data = await response.json()
  if (!response.ok) throw Error(data.error || "원격 요청을 처리하지 못했습니다.")
  return data
}

export function RemoteKeyListener({ idle, onBusy }: { idle: boolean; onBusy: (busy: boolean) => void }) {
  const idleRef = useRef(idle), running = useRef(false)
  const retries = useRef(new Map<string, { delay: number; nextAttemptAt: number; expiresAt: number }>())
  idleRef.current = idle
  const [room, setRoom] = useState("")
  const [message, setMessage] = useState("")
  useEffect(() => {
    let stopped = false
    let enabled: boolean | undefined
    const poll = async () => {
      const api = window.electronAPI?.cardKey
      if (stopped || running.current || !idleRef.current || !api?.issueRemote) return
      running.current = true
      let id = "", expiresAt = 0, cardIssued = false, claimed = false, busy = false
      try {
        // Checking native availability on every poll would continually reset
        // the updater's device-idle timer. Device settings apply on app restart.
        if (enabled === undefined) enabled = await api.available()
        if (!enabled) return
        const response = await fetch("/api/remote-key", { cache: "no-store", signal: AbortSignal.timeout(15000) })
        const data = await response.json()
        if (!response.ok || stopped || !idleRef.current || !Array.isArray(data.jobs)) return
        const now = Date.now()
        const jobs: { id: string; expiresAt: number }[] = data.jobs
        for (const [key, retry] of retries.current) {
          if (retry.expiresAt <= now) retries.current.delete(key)
        }
        const candidate = jobs.find(job => Number.isFinite(job.expiresAt) && job.expiresAt > now &&
          (retries.current.get(job.id)?.nextAttemptAt ?? 0) <= now)
        if (!candidate) return
        id = candidate.id
        expiresAt = candidate.expiresAt
        const job = await requestJob(id, "claim")
        claimed = true
        retries.current.delete(id)
        if (stopped || !idleRef.current) return
        busy = true
        onBusy(true)
        setMessage("")
        setRoom(job.receipt.roomNumber)
        if (!await autoConnectPrinter()) throw Error("프린터가 연결되지 않았습니다.")
        // The native service verifies the PMS signature and keeps a durable result
        // for this request, including across network retries and app restarts.
        let result
        for (let attempt = 0; attempt < 40; attempt++) {
          result = await api.issueRemote(job.envelope)
          if (result.reason !== "busy") break
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        if (!result?.success) throw Error(cardFailure(result || { success: false }))
        cardIssued = true
        // Claim printing before sending commands. An uncertain print is never
        // automatically repeated, even if its completion acknowledgement is lost.
        await requestJob(id, "printing")
        if (!await printRoomInfoReceipt(job.receipt)) throw Error("카드는 발급됐지만 인쇄에 실패했습니다.")
        await requestJob(id, "complete")
        setMessage(`${job.receipt.roomNumber} 카드 수령 및 인쇄 명령 완료`)
      } catch (error) {
        const message = error instanceof Error ? error.message : "원격 배출 확인이 필요합니다."
        if (claimed) {
          setMessage(message)
          await requestJob(id, "fail", { error: message, cardIssued }).catch(() => {})
        } else if (id) {
          const delay = Math.min((retries.current.get(id)?.delay ?? 15000) * 2, 300000)
          retries.current.set(id, { delay, nextAttemptAt: Date.now() + delay, expiresAt })
        }
      } finally {
        running.current = false
        if (busy) { setRoom(""); onBusy(false) }
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => { stopped = true; clearInterval(timer) }
  }, [onBusy])
  if (room) return <div role="status" className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white text-center">
    <CheckInCardProgress remoteRoom={room} />
  </div>
  return message ? <div role="status" className="fixed bottom-4 left-4 z-50 rounded border bg-white p-3 text-sm">{message}</div> : null
}

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
  idleRef.current = idle
  const [room, setRoom] = useState("")
  const [message, setMessage] = useState("")
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      const api = window.electronAPI?.cardKey
      if (stopped || running.current || !idleRef.current || !api?.issueRemote) return
      running.current = true
      let id = "", cardIssued = false, claimed = false
      try {
        if (!await api.available()) return
        const response = await fetch("/api/remote-key", { cache: "no-store", signal: AbortSignal.timeout(15000) })
        const data = await response.json()
        if (!response.ok || stopped || !idleRef.current || !data.jobs?.length) return
        id = data.jobs[0]
        onBusy(true)
        setRoom("객실"); setMessage("")
        const job = await requestJob(id, "claim")
        claimed = true
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
        setMessage(message)
        if (claimed) await requestJob(id, "fail", { error: message, cardIssued }).catch(() => {})
      } finally {
        running.current = false
        if (id) { setRoom(""); onBusy(false) }
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

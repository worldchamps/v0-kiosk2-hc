"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const labels: Record<string, string> = {
  ok: "정상 응답", ng: "장비 거부 응답", timeout: "8초 동안 응답 없음",
  late_ok: "3초 제한 이후 정상 응답", late_ng: "3초 제한 이후 거부 응답", send_failed: "장비 제어 프로그램으로 전송 실패",
}

export default function CashDeviceDiagnostics() {
  const [password, setPassword] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [logs, setLogs] = useState("")
  const [path, setPath] = useState("")
  const [results, setResults] = useState<string[]>([])

  const execute = async (command?: "reset" | "stop") => {
    const api = window.electronAPI?.cashDiagnostics
    if (!api) { setMessage("통신 기록을 지원하는 설치형 키오스크에서 실행해주세요."); return }
    setBusy(true)
    setMessage(command ? "응답을 8초간 관찰하고 있습니다. 지폐를 넣지 마세요." : "통신 기록을 읽고 있습니다.")
    try {
      if (command) {
        const result = await api.run({ password, command, confirmed })
        if (!result.success) { setMessage(result.error || "점검을 시작하지 못했습니다."); return }
        const summary = `${command === "reset" ? "초기화" : "투입 중지"}: ${labels[result.result || ""] || "결과 미확인"} (${Math.round(result.elapsedMs || 0)}ms)`
        setResults(previous => [...previous.slice(-9), summary])
        setMessage(result.logSaved ? summary : `${summary} / 기록 저장 실패`)
      }
      const record = await api.read(password)
      if (!record.success) { setMessage(record.error || "통신 기록을 읽지 못했습니다."); return }
      setLogs(record.text || "아직 기록된 통신이 없습니다.")
      setPath(record.path || "")
      if (!command) setMessage("최근 통신 기록을 읽었습니다.")
    } catch { setMessage("다른 장비 작업 또는 업데이트 중입니다. 완료 후 다시 확인해주세요.") }
    finally { setBusy(false) }
  }

  return <section className="max-w-5xl space-y-5 p-4">
    <h2 className="text-2xl font-bold">현금 통신 점검</h2>
    <p>초기화와 투입 중지를 각각 한 번 실행하고 응답을 8초간 관찰합니다. 현금 수취·반환·예약 생성은 실행하지 않습니다.</p>
    <p>기존 현금 건을 처리한 뒤, 고객이 사용하지 않는 시간에 점검하세요. 초기화만 성공한 경우 투입 중지도 확인하세요.</p>
    <label className="block max-w-sm space-y-2">관리자 비밀번호
      <Input type="password" autoComplete="off" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
    </label>
    <label className="flex items-center gap-3">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
      진행 중인 거래와 인식기 안에 처리 중인 지폐가 없음을 확인했습니다.
    </label>
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy || !password} variant="outline" onClick={() => execute()}>기록 읽기</Button>
      <Button disabled={busy || !password || !confirmed} onClick={() => execute("reset")}>초기화 응답 점검</Button>
      <Button disabled={busy || !password || !confirmed} onClick={() => execute("stop")}>투입 중지 응답 점검</Button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {results.length > 0 && <ul className="list-disc pl-6">{results.map((result, index) => <li key={index}>{result}</li>)}</ul>}
    <p className="text-sm">정상 응답은 명령 응답 확인 결과입니다. 실물 지폐 수납과 체크인 완료 검증은 별도입니다.</p>
    {path && <p className="break-all text-sm">저장 위치: {path}</p>}
    <Textarea aria-label="현금 통신 기록" value={logs} readOnly className="h-80 font-mono text-xs" />
  </section>
}

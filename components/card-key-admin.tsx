"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import AdminKeypad from "@/components/admin-keypad"
import type { CardKeyResult } from "@/types/electron"

const reasons: Record<string, string> = {
  disabled: "이 PC의 카드키 기능이 꺼져 있습니다.", disconnected: "카드 발급기 연결을 확인하세요.",
  busy: "다른 장비 작업이 끝난 뒤 다시 시도하세요.", timeout: "장비 응답 시간이 초과되었습니다.",
  inspection_required: "카드 위치가 미확정입니다. 장치 상태를 확인하거나 회수함으로 회수하세요.",
  card_present: "카드가 남아 있거나 이동 중입니다. 먼저 카드 위치를 확인하세요.",
  authentication_failed: "원본 카드 인증에 실패했습니다. 해당 섹터의 인증키를 업체에 확인해야 합니다.",
  unsupported_access: "이 카드의 접근권한은 현재 시험 발급에서 지원하지 않습니다.",
  profile_key_mismatch: "원본 카드의 인증키가 설정과 다릅니다.",
  stock_key_mismatch: "시험 발급은 공장 기본 인증키를 사용하는 카드만 지원합니다.",
  empty: "발급할 카드가 없습니다.", jam: "카드가 걸렸습니다.", overlap: "카드가 겹쳤습니다.",
  capture_full: "회수함이 가득 찼습니다.", hopper_full: "카드함이 가득 찼습니다.",
  verify_failed: "기록한 카드의 재읽기 검증에 실패했습니다.", not_taken: "60초 동안 수령되지 않아 카드를 회수했습니다.",
  protocol_unsynchronized: "통신 확인이 필요합니다. 카드를 확인한 뒤 회수를 실행하세요.",
  checksum: "통신 응답 검증에 실패했습니다.", nak: "장비가 명령을 거부했습니다.",
  room_not_registered: "먼저 해당 객실의 원본 카드를 등록하세요.",
  replacement_confirmation_required: "기존 등록일시를 확인한 뒤 교체를 승인하세요.",
  card_operation_failed: "카드 작업을 완료하지 못했습니다. 장치 상태와 등록 목록을 확인하세요.",
}
const progressText: Record<string, string> = {
  insert_original: "원본 객실 카드를 앞 투입구에 넣어주세요.", reading: "원본 카드를 읽고 있습니다.",
  issuing: "카드함에서 공카드를 가져와 기록·검증하고 있습니다.", presented: "앞 투입구의 카드를 가져가세요. 60초 후에는 회수함으로 회수합니다.",
  insert_return: "반납할 시험 카드를 앞 투입구에 넣어주세요.",
}

export default function CardKeyAdmin({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [password, setPassword] = useState("")
  const [unlocking, setUnlocking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [unresolved, setUnresolved] = useState(false)
  const [room, setRoom] = useState("")
  const [rooms, setRooms] = useState<{ room: string; registeredAt: string }[]>([])
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState<CardKeyResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [replacement, setReplacement] = useState(false)
  const roomKey = room.replace(/[\s-]+/g, "").toUpperCase()
  const existing = rooms.find(item => item.room === roomKey)

  useEffect(() => window.electronAPI?.cardKey?.onProgress(value => setMessage(progressText[value.state] || "카드 작업 중입니다.")), [])
  useEffect(() => { onBusy(busy || unresolved) }, [busy, unresolved, onBusy])

  const readList = async (candidate: string) => {
    const result = await window.electronAPI!.cardKey!.run("list", { password: candidate })
    if (!result.success) throw new Error(result.error || reasons[result.reason || ""] || "등록 목록을 읽지 못했습니다.")
    setRooms(result.rooms || [])
    return true
  }

  const run = async (command: "status" | "register" | "issue" | "capture" | "reset" | "return") => {
    const api = window.electronAPI?.cardKey
    if (!api) return
    setBusy(true)
    setMessage("장비 응답을 기다리고 있습니다.")
    try {
      const result = await api.run(command, { password, room: roomKey, confirmed,
        replaceRegisteredAt: replacement ? existing?.registeredAt : undefined,
        operationKey: command === "issue" ? crypto.randomUUID() : undefined })
      if (result.settled === false) setUnresolved(true)
      else if (result.settled === true) setUnresolved(false)
      if (command === "status" && result.success) { setStatus(result); setUnresolved(Boolean(result.sensors || result.moving)) }
      if (!result.success) {
        setMessage((result.error || reasons[result.reason || ""] || "카드 작업에 실패했습니다.") +
          (result.failedSectors?.length ? ` 실패 섹터: ${result.failedSectors.join(", ")}` : "") +
          (result.settled === false ? " 카드 위치가 미확정이므로 현장에서 확인하세요." : ""))
      } else {
        setMessage(command === "register" ? "원본 카드를 읽어 이 PC에 암호화 저장했습니다." :
          command === "issue" ? "시험 카드 기록·검증 및 수령을 확인했습니다. 고유번호는 변경하지 않았습니다. 실제 객실 문에서 열리는지 확인하세요." :
          command === "return" ? "카드함으로 회수했습니다. 객실 체크아웃은 처리하지 않습니다." :
          command === "capture" ? "회수함으로 회수했습니다." : command === "reset" ? "초기화 응답을 확인했습니다." : "장치 상태를 확인했습니다.")
      }
      if (command === "register" && result.success) { await readList(password); setReplacement(false) }
    } catch { setUnresolved(true); setMessage("응답을 확인하지 못했습니다. 카드 위치를 현장에서 확인하고 장치 상태를 다시 조회하세요.") }
    finally { setBusy(false) }
  }

  return <section className="max-w-4xl space-y-5 p-4">
    <h2 className="text-2xl font-bold">카드키 · 현장 시험</h2>
    <p>원본 객실 카드를 등록하고 공카드에 시험 기록합니다. 고객 체크인의 자동 발급은 아직 연결되지 않습니다.</p>
    <p className="rounded border border-amber-400 bg-amber-50 p-3">이번 시험은 카드 고유번호를 복사하지 않습니다. 기록 성공과 실제 도어락 개폐 성공은 별도로 확인해야 합니다.</p>
    {!password && <Button onClick={() => setUnlocking(true)}>관리자 인증 후 열기</Button>}
    {unlocking && <AdminKeypad showDevices={false} verifyPassword={readList} onClose={() => setUnlocking(false)}
      onConfirm={candidate => { setPassword(candidate); setUnlocking(false) }} />}
    {password && <>
      <label className="flex gap-3 items-start"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={event => setConfirmed(event.target.checked)} />고객 거래가 없고, 제조사 데모를 종료했으며, 직원이 장비 앞에서 카드를 확인하고 있습니다.</label>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} variant="outline" onClick={() => run("status")}>장치 상태</Button>
        <Button disabled={busy || !confirmed} variant="outline" onClick={() => run("capture")}>회수함으로 회수</Button>
        <Button disabled={busy || unresolved || !confirmed} variant="outline" onClick={() => run("reset")}>빈 장비 초기화</Button>
      </div>
      {status && <p>카드함: {status.empty ? "비었음" : status.low ? "적음" : status.hopperFull ? "가득 참" : "카드 있음"} · 회수함: {status.captureFull ? "가득 참" : "가득 차지 않음"} · 이송로: {status.moving ? "이동 중" : status.sensors ? "카드 있음" : "비었음"}
        {status.reason && ` · ${reasons[status.reason] || "장비 오류"}`}</p>}
      <label className="block space-y-2">객실 호수<Input value={room} disabled={busy || unresolved}
        onChange={event => { setRoom(event.target.value); setReplacement(false) }} placeholder="예: C101" autoComplete="off" list="card-key-rooms" /></label>
      <datalist id="card-key-rooms">{rooms.map(item => <option key={item.room} value={item.room} />)}</datalist>
      {existing && <label className="flex gap-3 items-center"><input type="checkbox" checked={replacement} disabled={busy}
        onChange={event => setReplacement(event.target.checked)} />기존 등록({new Date(existing.registeredAt).toLocaleString("ko-KR")})을 원본 카드로 교체합니다.</label>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy || unresolved || !confirmed || !roomKey || Boolean(existing && !replacement)} onClick={() => run("register")}>원본 카드 등록</Button>
        <Button disabled={busy || unresolved || !confirmed || !existing} onClick={() => run("issue")}>공카드 1장 시험 발급</Button>
        <Button disabled={busy || unresolved || !confirmed} variant="outline" onClick={() => run("return")}>시험 카드 반납</Button>
      </div>
      <p className="text-sm text-gray-600">공장 기본 인증키와 다시 기록할 수 있는 접근권한을 사용하는 카드로 시험합니다. 원본 카드는 읽기만 합니다. 인증에 실패하면 실패 섹터를 확인하고 등록을 중단합니다.</p>
      <table className="w-full text-left"><caption className="text-left font-semibold mb-2">등록된 객실 카드</caption><thead><tr><th>호수</th><th>등록일시</th></tr></thead>
        <tbody>{rooms.map(item => <tr key={item.room}><td className="py-2">{item.room}</td><td>{new Date(item.registeredAt).toLocaleString("ko-KR")}</td></tr>)}</tbody></table>
    </>}
    <p role="status" aria-live="polite" className="rounded border p-3 min-h-14">{message || "관리자 인증 후 장치 상태부터 확인하세요."}</p>
  </section>
}

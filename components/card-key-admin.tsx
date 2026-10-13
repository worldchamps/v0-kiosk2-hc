"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAdmin } from "@/contexts/admin-context"
import type { CardKeyResult } from "@/types/electron"

const reasons: Record<string, string> = {
  disabled: "이 PC의 카드키 기능이 꺼져 있습니다.", disconnected: "카드 발급기 연결을 확인하세요.",
  busy: "다른 장비 작업이 끝난 뒤 다시 시도하세요.", timeout: "장비 응답 시간이 초과되었습니다.",
  inspection_required: "카드 위치가 미확정입니다. 장치 상태를 확인하거나 회수함으로 회수하세요.",
  card_present: "카드가 남아 있거나 이동 중입니다. 먼저 카드 위치를 확인하세요.",
  authentication_failed: "원본 카드 인증에 실패했습니다. 해당 섹터의 인증키를 업체에 확인해야 합니다.",
  unsupported_access: "이 카드의 접근권한은 현재 발급에서 지원하지 않습니다.",
  profile_key_mismatch: "원본 카드의 인증키가 설정과 다릅니다.",
  stock_key_mismatch: "발급은 공장 기본 인증키를 사용하는 카드만 지원합니다.",
  empty: "발급할 카드가 없습니다.", jam: "카드가 걸렸습니다.", overlap: "카드가 겹쳤습니다.",
  capture_full: "회수함이 가득 찼습니다.", hopper_full: "카드함이 가득 찼습니다.",
  verify_failed: "기록한 카드의 재읽기 검증에 실패했습니다.", not_taken: "60초 동안 수령되지 않아 카드를 회수했습니다.",
  protocol_unsynchronized: "통신을 다시 확인해야 합니다. ‘장치 상태’를 눌러 재연결과 상태 조회를 실행하세요.",
  invalid_status: "장비에서 받은 상태 응답 형식이 예상과 다릅니다.",
  invalid_frame: "장비에서 받은 통신 프레임 형식이 예상과 다릅니다.",
  unexpected_response: "명령 순서와 일치하지 않는 응답을 받았습니다.",
  checksum: "통신 응답 검증에 실패했습니다.", nak: "장비가 명령을 거부했습니다.",
  room_not_registered: "먼저 해당 객실의 원본 카드를 등록하세요.",
  replacement_confirmation_required: "기존 등록일시를 확인한 뒤 교체를 승인하세요.",
  card_operation_failed: "카드 작업을 완료하지 못했습니다. 장치 상태와 등록 목록을 확인하세요.",
  card_command_failed: "장비가 카드 읽기·쓰기 명령의 실패를 보고했습니다.",
  invalid_block: "카드 데이터 응답 길이가 예상한 16바이트와 다릅니다.",
  invalid_uid_response: "카드 고유번호 응답을 해석하지 못했습니다. 카드 호환성 여부가 확인된 것은 아닙니다.",
  uid_mismatch: "읽은 고유번호와 원본 카드 데이터가 일치하지 않아 등록을 중단했습니다.",
  uid_copy_unsupported: "고유번호 포함 발급에는 4바이트 고유번호와 원본 첫 블록이 필요합니다. 해당 원본의 등록 정보를 확인하세요.",
  stock_uid_unsupported: "투입된 공카드의 고유번호 형식이 이번 CUID 발급과 다릅니다. 공카드 종류를 확인하세요.",
  invalid_source_identity: "저장된 원본 고유번호 정보가 서로 맞지 않아 발급을 중단했습니다. 원본 카드를 다시 등록하세요.",
  uid_write_failed: "공카드에 고유번호를 기록하지 못해 발급을 중단했습니다. 제공된 CUID 카드와 발급기의 고유번호 쓰기 호환성을 확인해야 합니다.",
  uid_verify_failed: "발급 카드의 고유번호 또는 첫 블록이 원본과 일치하지 않아 발급을 중단했습니다.",
  device_error: "장비 통신 처리 중 내부 오류가 발생했습니다.",
  command_rejected: "현재 장비 상태에서는 명령을 실행할 수 없습니다.",
  issue_error: "장비가 카드 이송 오류를 보고했습니다.",
  capture_error: "장비가 카드 회수 오류를 보고했습니다.",
  invalid_record: "저장된 원본 카드 데이터 형식이 올바르지 않습니다.",
  invalid_profile: "카드 인증 설정 형식이 올바르지 않습니다.",
  invalid_issue_mode: "발급 방식을 확인하세요.",
  issue_mode_mismatch: "이전 요청과 발급 방식이 다릅니다. 카드 상태를 확인한 뒤 다시 요청하세요.",
}
const cardCommands: Record<string, string> = {
  "4150": "장치 상태", "3B30": "카드 인식", "3B31": "고유번호 읽기",
  "3B32": "섹터 인증", "3B33": "데이터 읽기", "3B34": "데이터 기록", "4643": "카드 이동",
}
const deviceErrors: Record<number, string> = {
  0x00: "지원하지 않는 명령", 0x01: "명령 인수 오류", 0x02: "명령 데이터 오류",
  0x03: "명령 실행 불가", 0x04: "명령 실행 실패", 0x41: "카드 탐색 실패",
  0x42: "고유번호 읽기 실패", 0x43: "인증키 확인 실패", 0x44: "카드 선택 실패",
  0x45: "데이터 읽기 실패", 0x46: "데이터 쓰기 실패",
}
const progressText: Record<string, string> = {
  insert_original: "원본 객실 카드를 앞 투입구에 넣어주세요.", reading: "원본 카드를 읽고 있습니다.",
  issuing: "카드함에서 공카드를 가져와 기록·검증하고 있습니다.", presented: "앞 투입구의 카드를 가져가세요. 60초 후에는 회수함으로 회수합니다.",
  insert_return: "반납할 카드를 앞 투입구에 넣어주세요.",
}
const communicationStages: Record<string, string> = {
  port: "COM 포트 열기", write: "명령 전송", ack: "명령 수신 확인 대기", execute: "실행 요청 전송",
  response: "상태 응답 대기", decode: "상태 응답 해석", recovery: "이전 통신 정리",
}

export default function CardKeyAdmin({ onBusy, request, onRegistered, onClose }: {
  onBusy: (busy: boolean) => void
  request?: { room: string; command: "register" | "issue"; registeredAt?: string }
  onRegistered?: () => void
  onClose?: () => void
}) {
  const { password } = useAdmin()
  const [busy, setBusy] = useState(Boolean(request))
  const [unresolved, setUnresolved] = useState(false)
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState<CardKeyResult | null>(null)
  const inFlight = useRef(false)
  const started = useRef(false)
  useEffect(() => window.electronAPI?.cardKey?.onProgress(value => setMessage(progressText[value.state] || "카드 작업 중입니다.")), [])
  useEffect(() => { onBusy(busy || unresolved) }, [busy, unresolved, onBusy])

  const run = async (command: "status" | "register" | "issue" | "capture" | "reset" | "return") => {
    if (inFlight.current) return
    const api = window.electronAPI?.cardKey
    if (!api) { setBusy(false); setMessage("카드 발급기를 사용할 수 없습니다."); return }
    inFlight.current = true
    setBusy(true)
    setMessage("장비 응답을 기다리고 있습니다.")
    try {
      const result = await api.run(command, { password, room: request?.room, confirmed: true, issueMode: "uid_only",
        replaceRegisteredAt: request?.registeredAt,
        operationKey: command === "issue" ? crypto.randomUUID() : undefined })
      if (typeof result.recoveryRequired === "boolean") setUnresolved(result.recoveryRequired)
      else if (typeof result.settled === "boolean") setUnresolved(!result.settled)
      if (command === "status" && result.success) { setStatus(result); setUnresolved(Boolean(result.sensors || result.moving)) }
      if (!result.success) {
        const detail = result.errorStage ? ` [${result.port}, ${result.baudRate}bps, 장비 주소 ${result.address}: ${communicationStages[result.errorStage] || "통신 확인"}, 수신 ${result.receivedBytes || 0}바이트]` : ""
        const diagnosis = [
          result.reason ? `오류: ${result.reason}` : "오류: unknown",
          result.failedCommand && `실패 단계: ${cardCommands[result.failedCommand] || result.failedCommand}`,
          result.failedBlock !== undefined && `블록 ${result.failedBlock}`,
          result.deviceCode !== undefined && `장비 코드 0x${result.deviceCode.toString(16).toUpperCase().padStart(2, "0")} (${deviceErrors[result.deviceCode] || "미분류 오류"})`,
          result.responseBytes !== undefined && `응답 길이 ${result.responseBytes}바이트`,
        ].filter(Boolean).join(" · ")
        const failure = result.reason === "timeout" && result.errorStage === "ack" && result.receivedBytes === 0
          ? "COM 포트는 열렸지만 발급기에서 응답이 없습니다. 발급기 전원·RS232 케이블·장비 주소를 확인하세요."
          : result.reason === "disconnected" && result.errorStage === "port"
          ? "COM 포트를 열지 못했습니다. 제조사 데모를 종료하고 USB 연결을 확인한 뒤 ‘장치 상태’를 다시 누르세요."
          : result.error || reasons[result.reason || ""] || "카드 작업에 실패했습니다."
        setMessage(failure + detail + ` [${diagnosis}]` +
          (result.failedSectors?.length ? ` 실패 섹터: ${result.failedSectors.join(", ")}` : "") +
          ((result.recoveryRequired ?? (result.settled === false)) ? " 카드 위치가 미확정이므로 현장에서 확인하세요." : ""))
      } else {
        setMessage(command === "register" ? request?.room + " 원본 카드 등록이 완료되었습니다. 체크인할 때 카드키가 자동 발급됩니다." :
          command === "issue" ? request?.room + " 카드 발급과 수령이 완료되었습니다." + (result.dispenseMs !== undefined ? " 배출까지 " + (result.dispenseMs / 1000).toFixed(1) + "초." : "") :
          command === "return" ? "카드를 카드함으로 회수했습니다. 체크아웃은 처리하지 않습니다." :
          command === "capture" ? "회수함으로 회수했습니다." : command === "reset" ? "초기화 응답을 확인했습니다." : "장치 상태를 확인했습니다.")
        if (command === "register") onRegistered?.()
      }
    } catch { setUnresolved(true); setMessage("응답을 확인하지 못했습니다. 장치 상태를 조회하거나 회수함으로 회수하세요.") }
    finally { inFlight.current = false; setBusy(false) }
  }
  useEffect(() => {
    if (request && !started.current) { started.current = true; void run(request.command) }
  }, [request])

  return <section className="max-w-4xl space-y-5 p-4">
    <h2 className="text-2xl font-bold">{request ? request.room + (request.command === "register" ? " 원본 카드 등록" : " 카드 1장 발급") : "카드 발급기 관리"}</h2>
    {!request && <p>객실별 원본 카드 등록과 추가 발급은 ‘객실 정보’에서 할 수 있습니다.</p>}
    <p role="status" aria-live="polite" className="rounded border p-3 min-h-14">{message || "장비 응답을 기다리고 있습니다."}</p>
    {(!request || unresolved) && <div className="flex flex-wrap gap-3">
      <Button disabled={busy} variant="outline" onClick={() => run("status")}>장치 상태</Button>
      <Button disabled={busy} variant="outline" onClick={() => run("capture")}>회수함으로 회수</Button>
      {!request && <>
        <Button disabled={busy || unresolved} variant="outline" onClick={() => run("reset")}>빈 장비 초기화</Button>
        <Button disabled={busy || unresolved} variant="outline" onClick={() => run("return")}>카드 반납</Button>
      </>}
    </div>}
    {status && <p>카드함: {status.empty ? "비었음" : status.low ? "적음" : "카드 있음"} · 회수함: {status.captureFull ? "가득 참" : "가득 차지 않음"} · 이송로: {status.moving ? "이동 중" : status.sensors ? "카드 있음" : "비었음"}
      {status.reason && " · " + (reasons[status.reason] || "장비 오류")}</p>}
    {onClose && <Button disabled={busy || unresolved} onClick={onClose}>닫기</Button>}
  </section>
}

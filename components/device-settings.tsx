"use client"

import { useState } from "react"
import AdminKeypad from "@/components/admin-keypad"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { KioskDeviceSettingsRead, KioskDeviceSettingsValues } from "@/types/electron"

export default function DeviceSettings() {
  const [unlocking, setUnlocking] = useState(false)
  const [password, setPassword] = useState("")
  const [current, setCurrent] = useState<KioskDeviceSettingsRead | null>(null)
  const [values, setValues] = useState<KioskDeviceSettingsValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  const unlock = async (candidate: string) => {
    const api = window.electronAPI?.deviceSettings
    if (!api) throw new Error("설치형 키오스크에서만 장비를 등록할 수 있습니다.")
    const result = await api.read(candidate)
    if (!result.success || !result.values) throw new Error(result.error || "장비 설정을 읽지 못했습니다.")
    setCurrent(result)
    setValues(result.values)
    return true
  }

  const set = (key: keyof KioskDeviceSettingsValues, value: string) => {
    setValues(previous => previous ? { ...previous, [key]: value } : previous)
    setMessage("")
  }

  const save = async () => {
    if (!values || !password) return
    setBusy(true)
    setMessage("")
    try {
      const result = await window.electronAPI!.deviceSettings.save({ password, values })
      if (!result.success) { setMessage(result.error || "장비 설정을 저장하지 못했습니다."); return }
      setCurrent(null)
      setValues(null)
      setPassword("")
      setMessage("장비 설정을 저장했습니다. 진행 중인 거래가 끝난 뒤 설치형 앱을 정상 종료하고 다시 실행하면 적용됩니다.")
    } catch {
      setMessage("프로그램 업데이트나 다른 장비 작업 중입니다. 완료 후 다시 시도해주세요.")
    } finally { setBusy(false) }
  }

  const portInput = (key: keyof KioskDeviceSettingsValues, label: string, detail: string) => (
    <label className="block space-y-1" key={key}>
      <span className="font-medium">{label}</span>
      <Input list="kiosk-device-serial-ports" value={values?.[key] || ""} onChange={event => set(key, event.target.value)} placeholder="COM3" autoComplete="off" />
      <span className="block text-sm text-gray-600">{detail}</span>
    </label>
  )

  return <section className="max-w-4xl space-y-5 p-4">
    <h2 className="text-2xl font-bold">외부기기 등록</h2>
    <p>이 PC에 연결한 장비의 포트와 프린터를 지정합니다. 저장한 값은 이 설치형 앱의 암호화된 장비 설정에 보관됩니다.</p>
    {!values && <Button onClick={() => { setMessage(""); setUnlocking(true) }}>관리자 인증 후 장비 설정 열기</Button>}
    {message && <p role="status" aria-live="polite" className="rounded border p-3">{message}</p>}
    {unlocking && <AdminKeypad showDevices={false} onClose={() => setUnlocking(false)} verifyPassword={unlock}
      onConfirm={candidate => { setPassword(candidate); setUnlocking(false) }} />}
    {values && current && <>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">등록 숙소: {current.property}</p>
        <Button variant="outline" onClick={() => { setPassword(""); setValues(null); setCurrent(null) }}>설정 닫기</Button>
      </div>
      <datalist id="kiosk-device-serial-ports">
        {current.serialPorts?.map(port => <option key={port.path} value={port.path}>{port.manufacturer}</option>)}
      </datalist>
      <div className="rounded border p-4 space-y-4">
        <h3 className="text-xl font-semibold">토스 프론트</h3>
        <label className="block space-y-1">연결 방식
          <select className="flex h-10 w-full rounded-md border px-3" value={values.tossTransport}
            onChange={event => set("tossTransport", event.target.value)}>
            <option value="auto">자동 선택</option>
            <option value="serial">RS-232 시리얼</option>
            <option value="websocket">Wi-Fi / WebSocket</option>
          </select>
        </label>
        {portInput("tossSerialPath", "시리얼 COM 포트", "시리얼 연결 시 토스 프론트가 연결된 COM 번호를 지정합니다.")}
        <label className="block space-y-1">시리얼 통신 속도
          <Input type="number" min={1200} max={921600} value={values.tossSerialBaudRate}
            onChange={event => set("tossSerialBaudRate", event.target.value)} />
          <span className="block text-sm text-gray-600">프론트 플러그인 설정과 같아야 합니다. 기본값은 115200입니다.</span>
        </label>
        <label className="block space-y-1">WebSocket 주소
          <Input value={values.tossWsUrl} onChange={event => set("tossWsUrl", event.target.value)} placeholder="ws://192.168.0.10:9000/kiosk" autoComplete="off" />
        </label>
        <label className="block space-y-1">페어링 키
          <Input type="password" value={values.tossPairingKey} onChange={event => set("tossPairingKey", event.target.value)}
            placeholder={current.pairingKeySet ? "기존 키 유지 (변경할 때만 입력)" : "프론트 플러그인과 동일한 키 입력"} autoComplete="new-password" />
          <span className="block text-sm text-gray-600">기존 키는 화면에 표시하지 않습니다. 새 키를 입력하면 저장 시 교체됩니다.</span>
        </label>
      </div>
      {current.property === "property4" ? <div className="rounded border p-4 space-y-4">
        <h3 className="text-xl font-semibold">현금 보드 · SAM4S 프린터</h3>
        {portInput("bac2400Port", "BAC-2400 통합 보드", "지폐 인식기와 방출기가 공유하는 보드 COM 포트입니다.")}
        <label className="block space-y-1">Windows에 설치된 SAM4S 프린터 이름
          <Input list="kiosk-device-printers" value={values.sam4sPrinterName} onChange={event => set("sam4sPrinterName", event.target.value)}
            placeholder="비우면 SAM4S GCUBE 자동 검색" autoComplete="off" />
          <span className="block text-sm text-gray-600">프린터의 COM 포트는 Windows 프린터 속성에서 설정합니다.</span>
        </label>
        <datalist id="kiosk-device-printers">
          {current.printers?.map(printer => <option key={printer.name} value={printer.name}>{printer.displayName}</option>)}
        </datalist>
      </div> : current.property === "property2" ? <p className="rounded border p-4">
        이 숙소는 현재 현금 장비와 영수증 프린터를 사용하지 않습니다. 토스 프론트 연결 설정만 등록할 수 있습니다.
      </p> : <div className="rounded border p-4 space-y-4">
        <h3 className="text-xl font-semibold">지폐 장비 · {current.building === "B" ? "WOOSIM 프린터" : "Bixolon 프린터"}</h3>
        {current.building === "B" && <label className="block space-y-1">B동 WOOSIM WSP-CP383 Windows 프린터 이름
          <Input list="kiosk-device-printers" value={values.woosimPrinterName} onChange={event => set("woosimPrinterName", event.target.value)}
            placeholder="비우면 WSP-CP383 자동 검색" autoComplete="off" />
          <datalist id="kiosk-device-printers">{current.printers?.map(printer =>
            <option key={printer.name} value={printer.name}>{printer.displayName}</option>)}</datalist>
        </label>}
        {current.building !== "B" && portInput("printerPort", "Bixolon 프린터", "Hardware Server와 Electron 인쇄 경로에 같은 COM 포트를 적용합니다.")}
        {portInput("acceptorPort", "지폐 인식기", "지폐 인식기 COM 포트입니다.")}
        {portInput("dispenserPort", "지폐 방출기", "지폐 방출기 COM 포트입니다.")}
      </div>}
      <p className="text-sm text-gray-700">감지된 COM 포트: {current.serialPorts?.map(port => port.path).join(", ") || "없음"}. 목록에 없는 포트도 직접 입력할 수 있습니다. 하나의 COM 포트를 여러 장비에 지정할 수 없습니다.</p>
      <p className="text-sm text-gray-700">저장만으로 실행 중인 연결은 바뀌지 않습니다. 거래가 없는 때에 앱을 정상 종료하고 다시 실행한 뒤 ‘기기 연결 상태’와 실제 테스트 출력을 확인하세요.</p>
      <Button onClick={save} disabled={busy || !password}>{busy ? "저장 중..." : "장비 설정 저장"}</Button>
    </>}
  </section>
}

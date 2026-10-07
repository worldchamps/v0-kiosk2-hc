"use client"

import { useEffect, useState } from "react"

export default function CheckInCardProgress({ remoteRoom }: { remoteRoom?: string } = {}) {
  const [presented, setPresented] = useState(false)
  useEffect(() => window.electronAPI?.cardKey?.onProgress(value => setPresented(value.state === "presented")), [])
  return <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-white p-10 text-center">
    <h1 className="text-5xl font-bold">{presented ? "카드키를 가져가세요" : "객실 카드키를 준비하고 있습니다"}</h1>
    <p className="text-3xl">{presented ? "앞쪽 카드 투입구에서 카드키 1장을 꺼내주세요." : remoteRoom ? `${remoteRoom} 카드키와 안내문을 발급합니다. 잠시만 기다려주세요.` : "결제와 체크인이 완료되었습니다. 잠시만 기다려주세요."}</p>
    {presented && <p className="text-2xl">60초 동안 가져가지 않으면 카드를 회수합니다.</p>}
  </div>
}

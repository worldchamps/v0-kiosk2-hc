"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ModeSelector from "@/components/mode-selector"
import KioskLayout from "@/components/kiosk-layout"
import WebLayout from "@/components/web-layout"
import { saveKioskLocation } from "@/lib/location-utils"

export default function Home() {
  const [appMode, setAppMode] = useState<"kiosk" | "web" | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL 파라미터 확인
  useEffect(() => {
    const mode = searchParams.get("mode")
    const location = searchParams.get("location")?.toUpperCase()

    // URL 파라미터로 모드와 위치가 지정된 경우
    if (mode === "kiosk" && location) {
      // 유효한 위치인지 확인
      if (["A", "B", "D", "CAMP"].includes(location)) {
        // 키오스크 위치 저장 후 해당 위치의 키오스크 페이지로 이동
        saveKioskLocation(location as any)
        router.push(`/kiosk/${location}`)
        return
      }
    } else if (mode === "web") {
      // 웹모드로 이동
      router.push("/web")
      return
    }

    // 이전에 선택한 모드 확인
    if (typeof window !== "undefined") {
      const savedMode = localStorage.getItem("appMode") as "kiosk" | "web" | null
      if (savedMode) {
        setAppMode(savedMode)
      }
      setIsLoading(false)
    }
  }, [router, searchParams])

  const handleSelectMode = (mode: "kiosk" | "web") => {
    setAppMode(mode)
    localStorage.setItem("appMode", mode)
  }

  const handleChangeMode = () => {
    setAppMode(null)
    localStorage.removeItem("appMode")
  }

  // 키오스크 모드일 때 body에 kiosk-mode 클래스 추가
  useEffect(() => {
    if (appMode === "kiosk") {
      document.body.classList.add("kiosk-mode")
    } else {
      document.body.classList.remove("kiosk-mode")
    }

    return () => {
      document.body.classList.remove("kiosk-mode")
    }
  }, [appMode])

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">로딩 중...</div>
  }

  return (
    <main className={`w-full h-full p-0 m-0 ${appMode === "kiosk" ? "kiosk-mode" : ""}`}>
      {appMode === null ? (
        <ModeSelector onSelectMode={handleSelectMode} />
      ) : appMode === "kiosk" ? (
        <div className="kiosk-container">
          <KioskLayout onChangeMode={handleChangeMode} />
        </div>
      ) : (
        <WebLayout onChangeMode={handleChangeMode} />
      )}
    </main>
  )
}

"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ModeSelector from "@/components/mode-selector"
import KioskLayout from "@/components/kiosk-layout"
import WebLayout from "@/components/web-layout"
import { saveKioskLocation } from "@/lib/location-utils"

function HomeContent() {
  const [appMode, setAppMode] = useState<"kiosk" | "web" | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const mode = searchParams.get("mode")
    const location = searchParams.get("location")?.toUpperCase()

    if (mode === "kiosk" && location) {
      if (["A", "B", "D", "CAMP"].includes(location)) {
        saveKioskLocation(location as any)
        router.push(`/kiosk/${location}`)
        return
      }
    } else if (mode === "web") {
      setAppMode("web")
      if (typeof window !== "undefined") {
        localStorage.setItem("appMode", "web")
      }
      setIsLoading(false)
      return
    }

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

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">로딩 중...</div>}>
      <HomeContent />
    </Suspense>
  )
}

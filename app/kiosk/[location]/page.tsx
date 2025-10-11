"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { saveKioskLocation } from "@/lib/location-utils"
import KioskLayout from "@/components/kiosk-layout"

// 유효한 위치 목록
const validLocations = ["A", "B", "D", "CAMP"]

export default function KioskLocationPage({ params }: { params: { location: string } }) {
  const router = useRouter()
  const location = params.location.toUpperCase()

  useEffect(() => {
    // 유효한 위치인지 확인
    if (!validLocations.includes(location)) {
      // 유효하지 않은 위치면 홈으로 리다이렉트
      router.push("/")
      return
    }

    // 위치 저장
    saveKioskLocation(location as any)

    // 키오스크 모드 적용
    document.body.classList.add("kiosk-mode")

    return () => {
      document.body.classList.remove("kiosk-mode")
    }
  }, [location, router])

  // 유효하지 않은 위치면 로딩 표시
  if (!validLocations.includes(location)) {
    return <div className="flex items-center justify-center min-h-screen">리다이렉트 중...</div>
  }

  return <KioskLayout onChangeMode={() => router.push("/")} />
}

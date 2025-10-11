"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Monitor, Tablet } from "lucide-react"
import DirectLinks from "./direct-links"

interface ModeSelectorProps {
  onSelectMode: (mode: "kiosk" | "web") => void
}

export default function ModeSelector({ onSelectMode }: ModeSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<"kiosk" | "web" | null>(null)

  // 이전에 선택한 모드가 있는지 확인
  useEffect(() => {
    const savedMode = localStorage.getItem("appMode") as "kiosk" | "web" | null
    if (savedMode) {
      setSelectedMode(savedMode)
      // 자동으로 이전 모드 적용
      onSelectMode(savedMode)
    }
  }, [onSelectMode])

  const handleSelectMode = (mode: "kiosk" | "web") => {
    setSelectedMode(mode)
    localStorage.setItem("appMode", mode)
    onSelectMode(mode)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-4">
      <h1 className="text-3xl font-bold mb-8">모텔 예약 시스템</h1>
      <p className="text-lg text-gray-600 mb-8">사용 모드를 선택해주세요</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
        <Card
          className={`cursor-pointer transition-all ${
            selectedMode === "kiosk" ? "border-2 border-blue-500 shadow-lg" : "hover:shadow-md"
          }`}
          onClick={() => handleSelectMode("kiosk")}
        >
          <CardHeader className="flex flex-col items-center">
            <Tablet className="h-12 w-12 mb-2 text-blue-500" />
            <CardTitle>키오스크 모드</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-gray-600">현장에서 고객이 직접 사용하는 터치스크린 인터페이스</p>
            <Button
              className="mt-4"
              variant={selectedMode === "kiosk" ? "default" : "outline"}
              onClick={() => handleSelectMode("kiosk")}
            >
              키오스크 모드 선택
            </Button>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all ${
            selectedMode === "web" ? "border-2 border-blue-500 shadow-lg" : "hover:shadow-md"
          }`}
          onClick={() => handleSelectMode("web")}
        >
          <CardHeader className="flex flex-col items-center">
            <Monitor className="h-12 w-12 mb-2 text-blue-500" />
            <CardTitle>웹 모드</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-gray-600">관리자용 웹 인터페이스로 예약 관리 및 설정</p>
            <Button
              className="mt-4"
              variant={selectedMode === "web" ? "default" : "outline"}
              onClick={() => handleSelectMode("web")}
            >
              웹 모드 선택
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-12 w-full max-w-3xl">
        <DirectLinks />
      </div>
    </div>
  )
}

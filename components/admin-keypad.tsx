"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { X, ArrowLeft, Check } from "lucide-react"
import BillAcceptorTest from "./bill-acceptor-test"

interface AdminKeypadProps {
  onClose: () => void
  onConfirm: (password: string) => void
  adminPassword: string
}

export default function AdminKeypad({ onClose, onConfirm, adminPassword }: AdminKeypadProps) {
  const [input, setInput] = useState("")
  const [error, setError] = useState("")
  const [currentView, setCurrentView] = useState<"keypad" | "billTest">("keypad")

  // 키패드 레이아웃 - 특수 기호 추가
  const keypadLayout = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "*"],
    ["Z", "X", "C", "V", "B", "N", "M", "#", "@", "!"],
    ["$", "%", "&", "(", ")", "-", "+", "=", "/", "?"],
  ]

  // 키 입력 처리
  const handleKeyPress = (key: string) => {
    setInput((prev) => prev + key)
    setError("")
  }

  // 백스페이스 처리
  const handleBackspace = () => {
    setInput((prev) => prev.slice(0, -1))
    setError("")
  }

  // 확인 처리
  const handleConfirm = () => {
    if (input === adminPassword) {
      onConfirm(input)
    } else if (input === "BILL") {
      setCurrentView("billTest")
      setInput("")
      setError("")
    } else {
      setError("비밀번호가 일치하지 않습니다.")
      setInput("")
    }
  }

  const handleBackToKeypad = () => {
    setCurrentView("keypad")
    setInput("")
    setError("")
  }

  // ESC 키 누르면 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  if (currentView === "billTest") {
    return (
      <div className="fixed inset-0 z-50 bg-white overflow-auto">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">지폐인식기 테스트</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleBackToKeypad}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                돌아가기
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-6 w-6" />
              </Button>
            </div>
          </div>
          <BillAcceptorTest />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-white">
      <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">관리자 인증</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-6 w-6" />
          </Button>
        </div>

        {/* 비밀번호 입력 표시 */}
        <div className="relative mb-6">
          <div className="h-16 border-2 rounded-lg flex items-center px-4 bg-gray-50">
            <div className="text-2xl font-mono tracking-widest">{input.replace(/./g, "•")}</div>
          </div>
          {error && <p className="text-red-500 mt-2">{error}</p>}
        </div>

        {/* 키패드 */}
        <div className="space-y-2">
          {keypadLayout.map((row, rowIndex) => (
            <div key={rowIndex} className="flex justify-center gap-1">
              {row.map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  className="w-10 h-12 text-lg font-medium"
                  onClick={() => handleKeyPress(key)}
                >
                  {key}
                </Button>
              ))}
            </div>
          ))}

          {/* 기능 버튼 */}
          <div className="flex justify-between mt-4">
            <Button variant="outline" className="flex-1 h-12 mr-2" onClick={handleBackspace}>
              <ArrowLeft className="h-5 w-5 mr-1" />
              지우기
            </Button>
            <Button className="flex-1 h-12 bg-green-600 hover:bg-green-700" onClick={handleConfirm}>
              <Check className="h-5 w-5 mr-1" />
              확인
            </Button>
          </div>
        </div>
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-500">지폐인식기 테스트: "BILL" 입력</p>
        </div>
      </div>
    </div>
  )
}

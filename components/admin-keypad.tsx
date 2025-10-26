"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { X, ArrowLeft, Check, Printer, Banknote, DollarSign } from "lucide-react"
import { connectPrinter, isPrinterConnected } from "@/lib/printer-utils"
import { connectBillAcceptor, isBillAcceptorConnected } from "@/lib/bill-acceptor-utils"
import { connectBillDispenser, isBillDispenserConnected } from "@/lib/bill-dispenser-utils"

interface AdminKeypadProps {
  onClose: () => void
  onConfirm: (password: string) => void
  adminPassword: string
}

export default function AdminKeypad({ onClose, onConfirm, adminPassword }: AdminKeypadProps) {
  const [input, setInput] = useState("")
  const [error, setError] = useState("")

  const [printerConnected, setPrinterConnected] = useState(false)
  const [acceptorConnected, setAcceptorConnected] = useState(false)
  const [dispenserConnected, setDispenserConnected] = useState(false)
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null)

  // 키패드 레이아웃 - 특수 기호 추가
  const keypadLayout = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "*"],
    ["Z", "X", "C", "V", "B", "N", "M", "#", "@", "!"],
    ["$", "%", "&", "(", ")", "-", "+", "=", "/", "?"],
  ]

  useEffect(() => {
    const checkDeviceStatus = async () => {
      try {
        const printerStatus = await isPrinterConnected()
        setPrinterConnected(printerStatus)
      } catch (e) {
        setPrinterConnected(false)
      }

      setAcceptorConnected(isBillAcceptorConnected())
      setDispenserConnected(isBillDispenserConnected())
    }

    checkDeviceStatus()
    const interval = setInterval(checkDeviceStatus, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleConnectPrinter = async () => {
    setConnectingDevice("printer")
    setError("")
    try {
      const success = await connectPrinter()
      if (success) {
        setPrinterConnected(true)
        setError("")
      } else {
        setError("프린터 포트 선택 취소")
      }
    } catch (err) {
      setError(`프린터 연결 오류: ${err}`)
    } finally {
      setConnectingDevice(null)
    }
  }

  const handleConnectAcceptor = async () => {
    setConnectingDevice("acceptor")
    setError("")
    try {
      const success = await connectBillAcceptor()
      if (success) {
        setAcceptorConnected(true)
        setError("")
      } else {
        setError("지폐인식기 연결 실패")
      }
    } catch (err) {
      setError(`지폐인식기 연결 오류: ${err}`)
    } finally {
      setConnectingDevice(null)
    }
  }

  const handleConnectDispenser = async () => {
    setConnectingDevice("dispenser")
    setError("")
    try {
      const success = await connectBillDispenser()
      if (success) {
        setDispenserConnected(true)
        setError("")
      } else {
        setError("지폐방출기 연결 실패")
      }
    } catch (err) {
      setError(`지폐방출기 연결 오류: ${err}`)
    } finally {
      setConnectingDevice(null)
    }
  }

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
    } else {
      setError("비밀번호가 일치하지 않습니다.")
      setInput("")
    }
  }

  // ESC 키 누르면 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-white">
      <div className="w-full max-w-2xl p-6 bg-white rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">관리자 인증</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-6 w-6" />
          </Button>
        </div>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">디바이스 연결</h3>
          <div className="grid grid-cols-3 gap-3">
            {/* 프린터 연결 버튼 */}
            <Button
              variant={printerConnected ? "default" : "outline"}
              className={`h-20 flex flex-col items-center justify-center gap-2 ${
                printerConnected ? "bg-green-600 hover:bg-green-700" : ""
              }`}
              onClick={handleConnectPrinter}
              disabled={connectingDevice !== null}
            >
              <Printer className="h-6 w-6" />
              <span className="text-sm">
                {connectingDevice === "printer" ? "연결 중..." : printerConnected ? "프린터 연결됨" : "프린터 연결"}
              </span>
            </Button>

            {/* 지폐인식기 연결 버튼 */}
            <Button
              variant={acceptorConnected ? "default" : "outline"}
              className={`h-20 flex flex-col items-center justify-center gap-2 ${
                acceptorConnected ? "bg-green-600 hover:bg-green-700" : ""
              }`}
              onClick={handleConnectAcceptor}
              disabled={connectingDevice !== null}
            >
              <Banknote className="h-6 w-6" />
              <span className="text-sm">
                {connectingDevice === "acceptor"
                  ? "연결 중..."
                  : acceptorConnected
                    ? "지폐인식기 연결됨"
                    : "지폐인식기 연결"}
              </span>
            </Button>

            {/* 지폐방출기 연결 버튼 */}
            <Button
              variant={dispenserConnected ? "default" : "outline"}
              className={`h-20 flex flex-col items-center justify-center gap-2 ${
                dispenserConnected ? "bg-green-600 hover:bg-green-700" : ""
              }`}
              onClick={handleConnectDispenser}
              disabled={connectingDevice !== null}
            >
              <DollarSign className="h-6 w-6" />
              <span className="text-sm">
                {connectingDevice === "dispenser"
                  ? "연결 중..."
                  : dispenserConnected
                    ? "지폐방출기 연결됨"
                    : "지폐방출기 연결"}
              </span>
            </Button>
          </div>
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
                  className="w-10 h-12 text-lg font-medium bg-transparent"
                  onClick={() => handleKeyPress(key)}
                >
                  {key}
                </Button>
              ))}
            </div>
          ))}

          {/* 기능 버튼 */}
          <div className="flex justify-between mt-4">
            <Button variant="outline" className="flex-1 h-12 mr-2 bg-transparent" onClick={handleBackspace}>
              <ArrowLeft className="h-5 w-5 mr-1" />
              지우기
            </Button>
            <Button className="flex-1 h-12 bg-green-600 hover:bg-green-700" onClick={handleConfirm}>
              <Check className="h-5 w-5 mr-1" />
              확인
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

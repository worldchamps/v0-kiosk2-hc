"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { X, ArrowLeft, Check, Printer, Banknote, DollarSign } from "lucide-react"
import { autoConnectPrinter, isPrinterConnected } from "@/lib/printer-utils-unified"
import { connectBillAcceptor, isBillAcceptorConnected } from "@/lib/bill-acceptor-utils"
import { connectBillDispenser, isBillDispenserConnected } from "@/lib/bill-dispenser-utils"

interface AdminKeypadProps {
  onClose: () => void
  onConfirm: (password: string) => void
  adminPassword?: string
  verifyPassword?: (password: string) => Promise<boolean>
  showDevices?: boolean
}

export default function AdminKeypad({ onClose, onConfirm, adminPassword, verifyPassword, showDevices = true }: AdminKeypadProps) {
  const [input, setInput] = useState("")
  const [error, setError] = useState("")
  const [verifying, setVerifying] = useState(false)
  const verifyingRef = useRef(false)

  const [printerConnected, setPrinterConnected] = useState(false)
  const [acceptorConnected, setAcceptorConnected] = useState(false)
  const [dispenserConnected, setDispenserConnected] = useState(false)
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null)

  const keypadLayout = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "*"],
    ["Z", "X", "C", "V", "B", "N", "M", "#", "@", "!"],
    ["$", "%", "&", "(", ")", "-", "+", "=", "/", "?"],
  ]

  useEffect(() => {
    const checkDeviceStatus = async () => {
      setPrinterConnected(isPrinterConnected())
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
      const success = await autoConnectPrinter()
      if (success) {
        setPrinterConnected(true)
        setError("프린터 연결 완료")
      } else {
        setError("프린터 연결 실패")
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

  const handleKeyPress = (key: string) => {
    if (verifyingRef.current) return
    setInput((prev) => (prev + key).slice(0, 128))
    setError("")
  }

  const handleBackspace = () => {
    if (verifyingRef.current) return
    setInput((prev) => prev.slice(0, -1))
    setError("")
  }

  const handleConfirm = async () => {
    if (verifyingRef.current || !input) return
    verifyingRef.current = true
    setVerifying(true)
    try {
      const valid = verifyPassword ? await verifyPassword(input) : Boolean(adminPassword && input === adminPassword)
      if (valid) onConfirm(input)
      else { setError("비밀번호가 일치하지 않습니다."); setInput("") }
    } catch (error) {
      setError(error instanceof Error ? error.message : "관리자 인증을 확인하지 못했습니다.")
      setInput("")
    } finally { verifyingRef.current = false; setVerifying(false) }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !verifyingRef.current) onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-white">
      <div className="w-full max-w-2xl p-6 bg-white rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">관리자 인증</h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={verifying} aria-label="관리자 인증 닫기">
            <X className="h-6 w-6" />
          </Button>
        </div>

        {showDevices && <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">디바이스 연결</h3>
          <div className="grid grid-cols-3 gap-3">
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
        </div>}

        <div className="relative mb-6">
          <input aria-label="관리자 비밀번호" type="password" autoComplete="off" maxLength={128}
            className="h-16 w-full border-2 rounded-lg px-4 bg-gray-50 text-2xl" value={input} disabled={verifying}
            onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void handleConfirm() }} />
          {error && <p className="text-red-500 mt-2">{error}</p>}
        </div>

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

          <div className="flex justify-between mt-4">
            <Button variant="outline" className="flex-1 h-12 mr-2 bg-transparent" onClick={handleBackspace}>
              <ArrowLeft className="h-5 w-5 mr-1" />
              지우기
            </Button>
            <Button className="flex-1 h-12 bg-green-600 hover:bg-green-700" onClick={handleConfirm} disabled={verifying || !input}>
              <Check className="h-5 w-5 mr-1" />
              {verifying ? "확인 중..." : "확인"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

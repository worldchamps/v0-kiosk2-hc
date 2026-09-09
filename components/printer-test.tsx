"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Printer, WifiOff, Wifi, Loader2, CheckCircle2, XCircle, Type } from "lucide-react"
import {
  connectPrinter,
  disconnectPrinter,
  printTestPage,
  getSimplePrintMode,
  setSimplePrintMode,
  autoConnectPrinter,
} from "@/lib/printer-utils-unified"

export default function PrinterTest() {
  const [isPrinting, setIsPrinting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionType, setConnectionType] = useState<"serial" | "usb" | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [simpleMode, setSimpleMode] = useState(false)

  const isElectron = typeof window !== "undefined" && window.electronAPI

  // Load simple mode preference on component mount
  useEffect(() => {
    setSimpleMode(getSimplePrintMode())

    if (isElectron) {
      checkPrinterStatus()
      const interval = setInterval(checkPrinterStatus, 5000)
      return () => clearInterval(interval)
    }
  }, [isElectron])

  const checkPrinterStatus = async () => {
    if (isElectron) {
      try {
        setIsConnected(await autoConnectPrinter())
      } catch (err) {
        console.error("프린터 상태 확인 오류:", err)
      }
    }
  }

  // Toggle simple mode
  const handleToggleSimpleMode = () => {
    const newMode = !simpleMode
    setSimpleMode(newMode)
    setSimplePrintMode(newMode)
  }

  const handleSerialConnect = async () => {
    if (isElectron) {
      // Electron 환경: 이미 연결되어 있는지 확인
      if (await autoConnectPrinter()) {
        setIsConnected(true)
        setConnectionType("serial")
        setSuccess("인쇄 서버 연결을 확인했습니다. 프린터·용지는 테스트 출력으로 확인하세요.")
      } else {
        setError("프린터가 연결되어 있지 않습니다. Electron 앱을 재시작하세요.")
      }
    } else {
      // 웹 환경: Web Serial API 사용
      const connected = await connectPrinter()
      setIsConnected(connected)
      setConnectionType("serial")

      if (connected) {
        setSuccess("시리얼 프린터가 성공적으로 연결되었습니다.")
      } else {
        setError("프린터 연결에 실패했습니다. COM2 포트가 있는지 확인하세요.")
      }
    }
  }

  // 프린터 연결 해제 함수
  const handleDisconnect = async () => {
    setError("")
    setSuccess("")

    try {
      await disconnectPrinter()
      setIsConnected(false)
      setConnectionType(null)
      setSuccess("프린터 연결이 해제되었습니다.")
    } catch (err) {
      console.error("프린터 연결 해제 오류:", err)
      setError("프린터 연결 해제 중 오류가 발생했습니다.")
    }
  }

  const handlePrintTest = async () => {
    if (!isConnected && isElectron) {
      setError("프린터가 연결되어 있지 않습니다. Electron 앱을 재시작하세요.")
      return
    }

    setIsPrinting(true)
    setError("")
    setSuccess("")

    try {
      // 테스트 페이지 인쇄 함수 호출
      const success = await printTestPage()

      if (success) {
        setSuccess("인쇄 명령이 전달되었습니다. 실제 용지 출력과 절단을 확인하세요.")
      } else {
        setError("테스트 페이지 인쇄에 실패했습니다.")
      }
    } catch (err) {
      console.error("테스트 페이지 인쇄 오류:", err)
      setError("테스트 페이지 인쇄 중 오류가 발생했습니다.")
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-6 w-6" />
          프린터 테스트
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="bg-red-100 text-red-700 p-3 rounded-md flex items-center gap-2">
            <XCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-100 text-green-700 p-3 rounded-md flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            {success}
          </div>
        )}

        <div className="space-y-4">
          {isElectron ? (
            <div className="flex items-center gap-2 text-green-600">
              <Wifi className="h-5 w-5" />
              <span>{isConnected ? "인쇄 서버 연결 확인됨 (실물 프린터·용지 미확인)" : "인쇄 서버 연결 미확인"}</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-blue-50 p-3 rounded-md text-blue-700 text-sm">
                <p className="font-bold">안내:</p>
                <p>
                  프린터가 USB-시리얼 포트에 연결되어 있는지 확인하세요. 장치 관리자에서 프린터의 COM 포트 번호를 확인한
                  후 선택해주세요.
                </p>
              </div>

              <Button
                onClick={handleSerialConnect}
                disabled={isPrinting}
                className="w-full flex items-center justify-center gap-2"
              >
                {isPrinting ? <Loader2 className="h-5 w-5 animate-spin" /> : <WifiOff className="h-5 w-5" />}
                프린터 연결
              </Button>
            </div>
          )}

          <Button
            onClick={handlePrintTest}
            disabled={isPrinting || (isElectron && !isConnected)}
            className="w-full flex items-center justify-center gap-2"
          >
            {isPrinting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
            테스트 인쇄
          </Button>

          {!isElectron && isConnected && (
            <Button variant="outline" onClick={handleDisconnect} disabled={isPrinting}>
              연결 해제
            </Button>
          )}
        </div>

        <div className="mt-4 p-3 bg-gray-100 rounded-md text-sm">
          <p className="font-bold">프린터 정보 (BK3-3)</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>인터페이스: USB 2.0, 시리얼</li>
            <li>통신 속도: 9600 bps</li>
            <li>인쇄 너비: 68mm (546dot)</li>
            <li>인쇄 열: 42열</li>
            <li>인쇄 속도: 250mm/s</li>
            <li>절단 모드: 부분 절단</li>
            <li>코드페이지: PC437, PC860, PC863, PC865, WPC1252, KS5601(한글)</li>
          </ul>
        </div>
        <div className="mt-4 p-3 bg-gray-100 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Type className="h-5 w-5 text-gray-600" />
              <span className="font-bold">단순 인쇄 모드</span>
            </div>
            <Button
              variant={simpleMode ? "default" : "outline"}
              onClick={handleToggleSimpleMode}
              disabled
              title="인쇄 서버 방식에서는 모드 전환을 지원하지 않습니다."
              className={simpleMode ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {simpleMode ? "활성화됨" : "비활성화됨"}
            </Button>
          </div>
          <p className="text-sm mt-2 text-gray-600">
            현재 인쇄 서버 방식에서는 모드 전환을 지원하지 않습니다. 실제 출력·용지·절단은 테스트 인쇄로 확인하세요.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

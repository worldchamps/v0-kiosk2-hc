"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Printer, X, Check, AlertTriangle, Info } from "lucide-react"
import {
  printReceipt,
  disconnectPrinter,
  getSimplePrintMode,
  setSimplePrintMode,
  autoConnectPrinter,
  getPrinterModel,
} from "@/lib/printer-utils"

interface DirectPrinterProps {
  receiptData: any
  onClose: () => void
}

export default function DirectPrinter({ receiptData, onClose }: DirectPrinterProps) {
  const [status, setStatus] = useState<"idle" | "connecting" | "printing" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [simpleMode, setSimpleMode] = useState(false)
  const [printerModel, setPrinterModel] = useState<string>("UNKNOWN")

  // Load simple mode preference and printer model on component mount
  useEffect(() => {
    setSimpleMode(getSimplePrintMode())
    setPrinterModel(getPrinterModel())
  }, [])

  const handleToggleSimpleMode = () => {
    const newMode = !simpleMode
    setSimpleMode(newMode)
    setSimplePrintMode(newMode)
  }

  const handlePrint = async () => {
    setStatus("connecting")
    try {
      // Connect to printer using auto-connect first
      const connected = await autoConnectPrinter()
      if (!connected) {
        setStatus("error")
        setErrorMessage("프린터 연결에 실패했습니다.")
        return
      }

      // Update printer model after connection
      setPrinterModel(getPrinterModel())

      // Print receipt
      setStatus("printing")
      const success = await printReceipt(receiptData)
      if (success) {
        setStatus("success")
      } else {
        setStatus("error")
        setErrorMessage("영수증 인쇄에 실패했습니다.")
      }

      // Disconnect from printer
      await disconnectPrinter()
    } catch (error) {
      console.error("영수증 인쇄 오류:", error)
      setStatus("error")
      setErrorMessage(`인쇄 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xl">영수증 인쇄</CardTitle>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
          <span className="sr-only">닫기</span>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {status === "idle" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">인쇄 모드:</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleSimpleMode}
                  className={simpleMode ? "bg-green-100 hover:bg-green-200 border-green-300" : ""}
                >
                  {simpleMode ? "단순 모드" : "일반 모드"}
                </Button>
              </div>
              <div className="text-sm text-gray-500">
                {simpleMode
                  ? "단순 모드는 기본 텍스트만 사용하여 다양한 프린터와의 호환성을 높입니다."
                  : "일반 모드는 다양한 서식을 사용하여 시각적으로 강조된 영수증을 인쇄합니다."}
              </div>

              {/* 프린터 모델 정보 표시 */}
              {printerModel !== "UNKNOWN" && (
                <div className="bg-blue-50 p-3 rounded-md text-sm text-blue-700 flex items-start gap-2">
                  <Info className="h-4 w-4 mt-0.5" />
                  <div>
                    <p className="font-medium">감지된 프린터 모델: {printerModel}</p>
                    {printerModel === "BK3-3" && !simpleMode && (
                      <p className="mt-1">BK3-3 프린터는 일반 모드를 지원합니다.</p>
                    )}
                    {printerModel === "SAM4S" && !simpleMode && (
                      <p className="mt-1">SAM4S 프린터는 단순 모드를 권장합니다. 인쇄 문제가 발생할 수 있습니다.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-blue-50 p-3 rounded-md text-sm text-blue-700">
                <p>영수증에 포함된 정보:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>객실 번호: {receiptData.roomNumber || "N/A"}</li>
                  <li>비밀번호: {receiptData.password || "N/A"}</li>
                  <li>체크인: {receiptData.checkInDate || "N/A"}</li>
                  <li>체크아웃: {receiptData.checkOutDate || "N/A"}</li>
                </ul>
              </div>
              <Button className="w-full" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                영수증 인쇄
              </Button>
            </>
          )}

          {status === "connecting" && (
            <div className="text-center py-4">
              <div className="animate-pulse flex flex-col items-center">
                <Printer className="h-8 w-8 text-blue-500 mb-2" />
                <p>프린터에 연결 중...</p>
              </div>
            </div>
          )}

          {status === "printing" && (
            <div className="text-center py-4">
              <div className="animate-pulse flex flex-col items-center">
                <Printer className="h-8 w-8 text-blue-500 mb-2" />
                <p>영수증을 인쇄하고 있습니다...</p>
              </div>
            </div>
          )}

          {status === "success" && (
            <div className="text-center py-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full bg-green-100 p-3 mb-2">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <p className="text-green-600 font-medium">영수증이 성공적으로 인쇄되었습니다.</p>
                <Button variant="outline" className="mt-4" onClick={onClose}>
                  닫기
                </Button>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="text-center py-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full bg-red-100 p-3 mb-2">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <p className="text-red-600 font-medium">인쇄 오류</p>
                <p className="text-sm text-gray-600 mt-1">{errorMessage}</p>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" onClick={() => setStatus("idle")}>
                    다시 시도
                  </Button>
                  <Button variant="ghost" onClick={onClose}>
                    닫기
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

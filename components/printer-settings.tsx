"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Printer, Type, Settings, Info, AlertTriangle, Check, RefreshCw, Bug, X, Activity } from "lucide-react"
import {
  getSimplePrintMode,
  setSimplePrintMode,
  connectPrinter,
  printTestPage,
  isPrinterConnected,
  disconnectPrinter,
  getPrinterModel,
  getPrinterDiagnostics,
  clearCommandLog,
  checkPrinterReady,
} from "@/lib/printer-utils"

export default function PrinterSettings() {
  const [simpleMode, setSimpleMode] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [status, setStatus] = useState("")
  const [printerInfo, setPrinterInfo] = useState<string | null>(null)
  const [printerModel, setPrinterModel] = useState<string>("UNKNOWN")
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null)
  const [printerStatus, setPrinterStatus] = useState<any>(null)

  // Load current settings on component mount
  useEffect(() => {
    setSimpleMode(getSimplePrintMode())
    setIsConnected(isPrinterConnected())
    setPrinterModel(getPrinterModel())

    // Update connection status periodically
    const interval = setInterval(() => {
      setIsConnected(isPrinterConnected())
      setPrinterModel(getPrinterModel())
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  // Toggle simple mode
  const handleToggleSimpleMode = () => {
    const newMode = !simpleMode
    setSimpleMode(newMode)
    setSimplePrintMode(newMode)
    setStatus(`인쇄 모드가 ${newMode ? "단순 모드" : "일반 모드"}로 변경되었습니다.`)
  }

  // Connect to printer
  const handleConnectPrinter = async () => {
    setStatus("프린터에 연결 중...")
    try {
      const connected = await connectPrinter()
      if (connected) {
        setIsConnected(true)
        setPrinterModel(getPrinterModel())
        setStatus("프린터에 연결되었습니다.")
      } else {
        setStatus("프린터 연결에 실패했습니다.")
      }
    } catch (error) {
      console.error("프린터 연결 오류:", error)
      setStatus(`연결 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Disconnect from printer
  const handleDisconnectPrinter = async () => {
    try {
      await disconnectPrinter()
      setIsConnected(false)
      setStatus("프린터 연결이 해제되었습니다.")
    } catch (error) {
      console.error("프린터 연결 해제 오류:", error)
      setStatus(`연결 해제 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Test print with current settings
  const handleTestPrint = async () => {
    setIsPrinting(true)
    setStatus("테스트 인쇄 중...")

    try {
      if (!isConnected) {
        const connected = await connectPrinter()
        if (!connected) {
          setStatus("프린터 연결에 실패했습니다.")
          setIsPrinting(false)
          return
        }
        setIsConnected(true)
        setPrinterModel(getPrinterModel())
      }

      const success = await printTestPage()
      if (success) {
        setStatus(`테스트 인쇄가 완료되었습니다. (${simpleMode ? "단순 모드" : "일반 모드"})`)
      } else {
        setStatus("테스트 인쇄에 실패했습니다.")
      }
    } catch (error) {
      console.error("테스트 인쇄 오류:", error)
      setStatus(`인쇄 오류: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsPrinting(false)
    }
  }

  // Show printer diagnostics
  const handleShowDiagnostics = () => {
    const diagnostics = getPrinterDiagnostics()
    setDiagnosticsData(diagnostics)
    setShowDiagnostics(true)
  }

  // Clear command log
  const handleClearCommandLog = () => {
    clearCommandLog()
    setStatus("명령어 로그가 초기화되었습니다.")
    if (diagnosticsData) {
      setDiagnosticsData({
        ...diagnosticsData,
        commandLog: [],
      })
    }
  }

  const handleCheckPrinterStatus = async () => {
    setIsCheckingStatus(true)
    setStatus("프린터 상태 확인 중...")

    try {
      if (!isConnected) {
        const connected = await connectPrinter()
        if (!connected) {
          setStatus("프린터 연결에 실패했습니다.")
          setIsCheckingStatus(false)
          return
        }
        setIsConnected(true)
        setPrinterModel(getPrinterModel())
      }

      const statusResult = await checkPrinterReady()
      setPrinterStatus(statusResult)

      if (statusResult.ready) {
        setStatus(`✅ ${statusResult.message}`)
      } else {
        setStatus(`❌ ${statusResult.message}`)
      }
    } catch (error) {
      console.error("프린터 상태 확인 오류:", error)
      setStatus(`상태 확인 오류: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsCheckingStatus(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          프린터 설정
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleShowDiagnostics}>
            <Bug className="h-4 w-4 mr-1" />
            진단
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <div
            className={`p-3 rounded-md ${
              status.includes("실패") || status.includes("오류") || status.includes("❌")
                ? "bg-red-50 text-red-700"
                : status.includes("완료") || status.includes("연결되었습니다") || status.includes("✅")
                  ? "bg-green-50 text-green-700"
                  : "bg-blue-50 text-blue-700"
            }`}
          >
            {status.includes("실패") || status.includes("오류") || status.includes("❌") ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span>{status}</span>
              </div>
            ) : status.includes("완료") || status.includes("연결되었습니다") || status.includes("✅") ? (
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4" />
                <span>{status}</span>
              </div>
            ) : (
              <span>{status}</span>
            )}
          </div>
        )}

        {printerStatus && (
          <div className={`p-3 rounded-md ${printerStatus.ready ? "bg-green-50" : "bg-yellow-50"}`}>
            <h4 className="font-medium mb-2">프린터 실시간 상태</h4>
            <div className="text-sm space-y-1">
              <p>
                <strong>온라인:</strong> {printerStatus.online ? "✅ 예" : "❌ 아니오"}
              </p>
              <p>
                <strong>용지:</strong> {printerStatus.paperOut ? "❌ 없음" : "✅ 있음"}
              </p>
              <p>
                <strong>에러:</strong> {printerStatus.error ? "❌ 있음" : "✅ 없음"}
              </p>
              {printerStatus.statusByte !== undefined && (
                <p className="text-xs text-gray-500">
                  상태 바이트: 0x{printerStatus.statusByte.toString(16).padStart(2, "0")}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="h-5 w-5" />
                <h3 className="font-medium">인쇄 모드</h3>
              </div>
              <Button
                variant={simpleMode ? "default" : "outline"}
                onClick={handleToggleSimpleMode}
                className={simpleMode ? "bg-green-600 hover:bg-green-700" : ""}
              >
                {simpleMode ? "단순 모드" : "일반 모드"}
              </Button>
            </div>
            <p className="text-sm text-gray-600">
              단순 모드는 기본 텍스트만 사용하여 복잡한 서식 없이 인쇄합니다. SAM4S ELLIX/GIANT 프린터와 같은 다양한
              프린터와의 호환성 문제가 있을 경우 이 모드를 사용하세요.
            </p>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium flex items-center gap-2">
                <Printer className="h-5 w-5" />
                프린터 상태
              </h3>
              <span
                className={`px-2 py-1 rounded-full text-xs ${isConnected ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}
              >
                {isConnected ? "연결됨" : "연결 안됨"}
              </span>
            </div>

            {isConnected && (
              <div className="bg-gray-50 p-3 rounded-md mb-3">
                <p className="text-sm">
                  <strong>감지된 프린터 모델:</strong> {printerModel}
                </p>
                <p className="text-sm">
                  <strong>현재 모드:</strong> {simpleMode ? "단순 모드" : "일반 모드"}
                </p>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {!isConnected ? (
                <Button onClick={handleConnectPrinter} className="flex items-center gap-2">
                  <Printer className="h-4 w-4" />
                  <span>프린터 연결</span>
                </Button>
              ) : (
                <Button
                  onClick={handleDisconnectPrinter}
                  variant="outline"
                  className="flex items-center gap-2 bg-transparent"
                >
                  <Printer className="h-4 w-4" />
                  <span>연결 해제</span>
                </Button>
              )}

              <Button
                onClick={handleCheckPrinterStatus}
                disabled={isCheckingStatus}
                variant="outline"
                className="flex items-center gap-2 bg-transparent"
              >
                {isCheckingStatus ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>확인 중...</span>
                  </>
                ) : (
                  <>
                    <Activity className="h-4 w-4" />
                    <span>상태 확인</span>
                  </>
                )}
              </Button>

              <Button onClick={handleTestPrint} disabled={isPrinting} className="flex items-center gap-2">
                {isPrinting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>인쇄 중...</span>
                  </>
                ) : (
                  <>
                    <Printer className="h-4 w-4" />
                    <span>테스트 인쇄</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-md mt-4">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-500 mt-0.5" />
              <div>
                <h4 className="font-medium">프린터 모드 정보</h4>
                <p className="text-sm text-gray-600 mt-1">
                  <strong>일반 모드:</strong> 다양한 글꼴 크기와 서식을 사용하여 시각적으로 강조된 영수증을 인쇄합니다.
                  BK-3 프린터와 같은 ESC/POS 명령어를 완전히 지원하는 프린터에 적합합니다.
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  <strong>단순 모드:</strong> 기본 텍스트만 사용하여 최소한의 서식 명령으로 영수증을 인쇄합니다. SAM4S
                  ELLIX/GIANT 프린터와 같은 다양한 프린터 모델과의 호환성이 높으며, 인쇄 오류가 발생할 경우 이 모드를
                  사용해보세요.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 p-4 rounded-md mt-4">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-500 mt-0.5" />
              <div>
                <h4 className="font-medium">프린터 모델별 권장 설정</h4>
                <p className="text-sm text-gray-600 mt-1">
                  <strong>BK3-3 프린터:</strong> 일반 모드를 권장합니다. 다양한 글꼴 크기와 서식을 지원합니다.
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  <strong>SAM4S ELLIX/GIANT 프린터:</strong> 단순 모드를 권장합니다. 이 프린터는 일부 고급 서식 명령어를
                  다르게 해석할 수 있습니다.
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  인쇄 문제가 계속되면 프린터를 물리적으로 재설정하거나, 브라우저를 새로고침한 후 다시 시도해보세요.
                </p>
              </div>
            </div>
          </div>

          {/* 환경 변수 정보 */}
          <div className="bg-yellow-50 p-4 rounded-md mt-4">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div>
                <h4 className="font-medium">환경 변수 설정</h4>
                <p className="text-sm text-gray-600 mt-1">
                  <strong>PRINTER_SIMPLE_MODE:</strong> 이 환경 변수를 "true"로 설정하면 모든 프린터에서 단순 모드가
                  강제로 활성화됩니다.
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  <strong>FORCE_SIMPLE_FOR_BK3:</strong> 이 환경 변수를 "true"로 설정하면 BK3-3 프린터에서 단순 모드가
                  강제로 활성화됩니다. 이는 BK3-3 프린터가 일반 모드에서 문제를 일으키는 경우에 유용합니다.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 프린터 진단 정보 모달 */}
        {showDiagnostics && diagnosticsData && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">프린터 진단 정보</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowDiagnostics(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">기본 정보</h4>
                  <div className="bg-gray-50 p-3 rounded-md">
                    <p>
                      <strong>연결 상태:</strong> {diagnosticsData.connected ? "연결됨" : "연결 안됨"}
                    </p>
                    <p>
                      <strong>감지된 프린터 모델:</strong> {diagnosticsData.model}
                    </p>
                    <p>
                      <strong>단순 모드:</strong> {diagnosticsData.simpleMode ? "활성화" : "비활성화"}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-2">환경 변수</h4>
                  <div className="bg-gray-50 p-3 rounded-md">
                    <p>
                      <strong>PRINTER_SIMPLE_MODE:</strong> {diagnosticsData.environmentVariables.PRINTER_SIMPLE_MODE}
                    </p>
                    <p>
                      <strong>FORCE_SIMPLE_FOR_BK3:</strong> {diagnosticsData.environmentVariables.FORCE_SIMPLE_FOR_BK3}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-2">연결 정보</h4>
                  <div className="bg-gray-50 p-3 rounded-md">
                    <pre className="text-xs overflow-auto">
                      {JSON.stringify(diagnosticsData.connectionInfo, null, 2)}
                    </pre>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">명령어 로그 (최근 10개)</h4>
                    <Button variant="outline" size="sm" onClick={handleClearCommandLog}>
                      로그 초기화
                    </Button>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-md">
                    {diagnosticsData.commandLog && diagnosticsData.commandLog.length > 0 ? (
                      <div className="max-h-60 overflow-y-auto">
                        {diagnosticsData.commandLog.map((log: any, index: number) => (
                          <div key={index} className="border-b border-gray-200 py-2 last:border-0">
                            <p className="text-xs text-gray-500">{log.timestamp}</p>
                            <p className="text-sm font-medium">{log.command}</p>
                            <p className="text-xs font-mono">
                              {log.bytes.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">명령어 로그가 없습니다.</p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end mt-4">
                  <Button onClick={() => setShowDiagnostics(false)}>닫기</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Banknote, Info, AlertTriangle, Check, RefreshCw, Bug, X, Power, PowerOff, RotateCcw } from "lucide-react"
import {
  connectBillAcceptor,
  disconnectBillAcceptor,
  isBillAcceptorConnected,
  getBillAcceptorStatus,
  getBillAcceptorCommandLog,
  clearBillAcceptorCommandLog,
  checkConnection,
  getStatus,
  getVersion,
  getConfig,
  enableAcceptance,
  disableAcceptance,
  resetDevice,
  processBillAcceptance,
  getStatusString,
  getErrorString,
  getErrorCode,
} from "@/lib/bill-acceptor-utils"

export default function BillAcceptorSettings() {
  const [isConnected, setIsConnected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState("")
  const [deviceStatus, setDeviceStatus] = useState<any>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null)
  const [acceptanceResult, setAcceptanceResult] = useState<any>(null)

  // Load current settings on component mount
  useEffect(() => {
    setIsConnected(isBillAcceptorConnected())

    // Update connection status periodically
    const interval = setInterval(async () => {
      const connected = isBillAcceptorConnected()
      setIsConnected(connected)

      if (connected) {
        const deviceStatus = getBillAcceptorStatus()
        setDeviceStatus(deviceStatus)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  // Connect to bill acceptor
  const handleConnect = async () => {
    setStatus("지폐인식기에 연결 중...")
    try {
      const connected = await connectBillAcceptor()
      if (connected) {
        setIsConnected(true)
        setStatus("지폐인식기에 연결되었습니다.")

        // Get initial status
        const version = await getVersion()
        const config = await getConfig()
        const currentStatus = await getStatus()

        setDeviceStatus({
          ...getBillAcceptorStatus(),
          version,
          config,
          currentStatus,
        })
      } else {
        setStatus("지폐인식기 연결에 실패했습니다.")
      }
    } catch (error) {
      console.error("지폐인식기 연결 오류:", error)
      setStatus(`연결 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Disconnect from bill acceptor
  const handleDisconnect = async () => {
    try {
      await disconnectBillAcceptor()
      setIsConnected(false)
      setDeviceStatus(null)
      setStatus("지폐인식기 연결이 해제되었습니다.")
    } catch (error) {
      console.error("지폐인식기 연결 해제 오류:", error)
      setStatus(`연결 해제 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Test connection
  const handleTestConnection = async () => {
    setStatus("연결 테스트 중...")
    try {
      const result = await checkConnection()
      if (result) {
        setStatus("연결 테스트 성공!")
      } else {
        setStatus("연결 테스트 실패!")
      }
    } catch (error) {
      setStatus(`테스트 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Reset device
  const handleReset = async () => {
    setStatus("디바이스 리셋 중...")
    try {
      const result = await resetDevice()
      if (result) {
        setStatus("디바이스 리셋 완료!")
      } else {
        setStatus("디바이스 리셋 실패!")
      }
    } catch (error) {
      setStatus(`리셋 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Enable acceptance
  const handleEnableAcceptance = async () => {
    setStatus("지폐 수취 활성화 중...")
    try {
      const result = await enableAcceptance()
      if (result) {
        setStatus("지폐 수취가 활성화되었습니다.")
      } else {
        setStatus("지폐 수취 활성화 실패!")
      }
    } catch (error) {
      setStatus(`활성화 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Disable acceptance
  const handleDisableAcceptance = async () => {
    setStatus("지폐 수취 비활성화 중...")
    try {
      const result = await disableAcceptance()
      if (result) {
        setStatus("지폐 수취가 비활성화되었습니다.")
      } else {
        setStatus("지폐 수취 비활성화 실패!")
      }
    } catch (error) {
      setStatus(`비활성화 오류: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Process bill acceptance
  const handleProcessBill = async () => {
    setIsProcessing(true)
    setStatus("지폐를 넣어주세요...")
    setAcceptanceResult(null)

    try {
      const result = await processBillAcceptance()
      setAcceptanceResult(result)

      if (result.success) {
        setStatus(`지폐 수취 완료: ${result.amount.toLocaleString()}원`)
      } else {
        setStatus(`지폐 수취 실패: ${result.error}`)
      }
    } catch (error) {
      setStatus(`처리 오류: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsProcessing(false)
    }
  }

  // Show diagnostics
  const handleShowDiagnostics = async () => {
    const commandLog = getBillAcceptorCommandLog()
    const status = getBillAcceptorStatus()

    let currentStatus = null
    let errorCode = null

    if (isConnected) {
      currentStatus = await getStatus()
      if (currentStatus === 0x0c) {
        // ERROR_WAIT
        errorCode = await getErrorCode()
      }
    }

    setDiagnosticsData({
      ...status,
      commandLog,
      currentStatus,
      errorCode,
      deviceStatus,
    })
    setShowDiagnostics(true)
  }

  // Clear command log
  const handleClearCommandLog = () => {
    clearBillAcceptorCommandLog()
    setStatus("명령어 로그가 초기화되었습니다.")
    if (diagnosticsData) {
      setDiagnosticsData({
        ...diagnosticsData,
        commandLog: [],
      })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Banknote className="h-5 w-5" />
          지폐인식기 설정
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
              status.includes("실패") || status.includes("오류")
                ? "bg-red-50 text-red-700"
                : status.includes("완료") || status.includes("연결되었습니다") || status.includes("성공")
                  ? "bg-green-50 text-green-700"
                  : "bg-blue-50 text-blue-700"
            }`}
          >
            {status.includes("실패") || status.includes("오류") ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span>{status}</span>
              </div>
            ) : status.includes("완료") || status.includes("연결되었습니다") || status.includes("성공") ? (
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4" />
                <span>{status}</span>
              </div>
            ) : (
              <span>{status}</span>
            )}
          </div>
        )}

        {acceptanceResult && (
          <div
            className={`p-3 rounded-md ${
              acceptanceResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {acceptanceResult.success ? (
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4" />
                <span>지폐 수취 성공: {acceptanceResult.amount.toLocaleString()}원</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span>지폐 수취 실패: {acceptanceResult.error}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                지폐인식기 상태
              </h3>
              <Badge variant={isConnected ? "default" : "secondary"}>{isConnected ? "연결됨" : "연결 안됨"}</Badge>
            </div>

            {isConnected && deviceStatus && (
              <div className="bg-gray-50 p-3 rounded-md mb-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <p>
                    <strong>수취 상태:</strong> {deviceStatus.accepting ? "활성화" : "비활성화"}
                  </p>
                  <p>
                    <strong>현재 상태:</strong> {getStatusString(deviceStatus.currentStatus)}
                  </p>
                  {deviceStatus.version && (
                    <p>
                      <strong>펌웨어:</strong> v{deviceStatus.version.major}.{deviceStatus.version.minor}
                    </p>
                  )}
                  {deviceStatus.config !== undefined && (
                    <p>
                      <strong>설정:</strong> 0x{deviceStatus.config.toString(16).padStart(2, "0")}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!isConnected ? (
                <Button onClick={handleConnect} className="flex items-center gap-2">
                  <Power className="h-4 w-4" />
                  <span>연결</span>
                </Button>
              ) : (
                <>
                  <Button onClick={handleDisconnect} variant="outline" className="flex items-center gap-2">
                    <PowerOff className="h-4 w-4" />
                    <span>연결 해제</span>
                  </Button>
                  <Button onClick={handleTestConnection} variant="outline" className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    <span>연결 테스트</span>
                  </Button>
                  <Button onClick={handleReset} variant="outline" className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4" />
                    <span>리셋</span>
                  </Button>
                </>
              )}
            </div>

            {isConnected && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="font-medium mb-2">지폐 수취 제어</h4>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleEnableAcceptance} variant="outline" className="flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    <span>수취 활성화</span>
                  </Button>
                  <Button onClick={handleDisableAcceptance} variant="outline" className="flex items-center gap-2">
                    <X className="h-4 w-4" />
                    <span>수취 비활성화</span>
                  </Button>
                  <Button onClick={handleProcessBill} disabled={isProcessing} className="flex items-center gap-2">
                    {isProcessing ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>처리 중...</span>
                      </>
                    ) : (
                      <>
                        <Banknote className="h-4 w-4" />
                        <span>지폐 수취 테스트</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gray-50 p-4 rounded-md">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-500 mt-0.5" />
              <div>
                <h4 className="font-medium">지폐인식기 정보</h4>
                <p className="text-sm text-gray-600 mt-1">
                  <strong>지원 지폐:</strong> 1,000원, 5,000원, 10,000원, 50,000원
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  <strong>통신 방식:</strong> RS-232 (9600 baud, 8N1)
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  <strong>모델:</strong> ONEPLUS Bill Acceptor
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 진단 정보 모달 */}
        {showDiagnostics && diagnosticsData && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">지폐인식기 진단 정보</h3>
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
                      <strong>수취 상태:</strong> {diagnosticsData.accepting ? "활성화" : "비활성화"}
                    </p>
                    <p>
                      <strong>현재 상태:</strong> {getStatusString(diagnosticsData.currentStatus)}
                    </p>
                    {diagnosticsData.errorCode && (
                      <p>
                        <strong>에러 코드:</strong> {getErrorString(diagnosticsData.errorCode)}
                      </p>
                    )}
                  </div>
                </div>

                {diagnosticsData.deviceStatus && (
                  <div>
                    <h4 className="font-medium mb-2">디바이스 정보</h4>
                    <div className="bg-gray-50 p-3 rounded-md">
                      <pre className="text-xs overflow-auto">
                        {JSON.stringify(diagnosticsData.deviceStatus, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

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
                        {diagnosticsData.commandLog.slice(-10).map((log: any, index: number) => (
                          <div key={index} className="border-b border-gray-200 py-2 last:border-0">
                            <p className="text-xs text-gray-500">{log.timestamp}</p>
                            <p className="text-sm font-medium">{log.command}</p>
                            <p className="text-xs font-mono">
                              TX: {log.bytes.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")}
                            </p>
                            {log.response && (
                              <p className="text-xs font-mono">
                                RX: {log.response.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")}
                              </p>
                            )}
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

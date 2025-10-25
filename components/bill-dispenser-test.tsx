"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import {
  Banknote,
  Power,
  PowerOff,
  RotateCcw,
  Eye,
  Download,
  AlertTriangle,
  Wifi,
  WifiOff,
  Send,
  Trash,
  RefreshCw,
  Ban,
  CheckCircle,
} from "lucide-react"
import {
  connectBillDispenser,
  disconnectBillDispenser,
  isBillDispenserConnected,
  getBillDispenserStatus,
  getBillDispenserCommandLog,
  clearBillDispenserCommandLog,
  resetDispenser,
  dispenseBills,
  disableDispenser,
  enableDispenser,
  clearDispensedCount,
  getTotalDispensedCount,
  clearTotalDispensedCount,
  getStatus,
  getErrorCode,
  getStatusString,
  setProtocolVersion,
} from "@/lib/bill-dispenser-utils"

export default function BillDispenserTest() {
  const [isConnected, setIsConnected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [deviceStatus, setDeviceStatus] = useState<any>(null)
  const [dispensedBills, setDispensedBills] = useState<number[]>([])
  const [dispenseBillCount, setDispenseBillCount] = useState<number>(1)
  const [txMessages, setTxMessages] = useState<string[]>([])
  const [rxMessages, setRxMessages] = useState<string[]>([])
  const [selectedPort, setSelectedPort] = useState("COM5")
  const [isOldProtocol, setIsOldProtocol] = useState(true)
  const [totalDispensed, setTotalDispensed] = useState<number | null>(null)
  const [errorInfo, setErrorInfo] = useState<{ code: number; description: string } | null>(null)

  const isElectron = typeof window !== "undefined" && window.electronAPI

  // Update connection status and device info
  useEffect(() => {
    const interval = setInterval(async () => {
      const connected = isBillDispenserConnected()
      setIsConnected(connected)

      if (connected) {
        const status = getBillDispenserStatus()
        setDeviceStatus(status)

        // Update command log
        const commandLog = getBillDispenserCommandLog()
        if (commandLog.length > 0) {
          const latestCommand = commandLog[commandLog.length - 1]

          // Add to TX messages
          const txHex = latestCommand.bytes
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ")
            .toUpperCase()
          setTxMessages((prev) => [...prev.slice(-9), `${latestCommand.command}: ${txHex}`])

          // Add to RX messages if response exists
          if (latestCommand.response) {
            const rxHex = latestCommand.response
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" ")
              .toUpperCase()
            setRxMessages((prev) => [...prev.slice(-9), `Response: ${rxHex}`])
          }
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Connect to bill dispenser
  const handleConnect = async () => {
    setIsProcessing(true)
    setStatus("지폐방출기에 연결 중...")
    setError("")

    try {
      if (isElectron) {
        // Electron 환경: 이미 연결되어 있는지 확인
        const status = await window.electronAPI.getBillDispenserStatus()
        if (status && status.connected) {
          setIsConnected(true)
          setStatus("지폐방출기가 이미 연결되어 있습니다 (COM5)")
        } else {
          setError("지폐방출기가 연결되어 있지 않습니다. Electron 앱을 재시작하세요.")
        }
      } else {
        // 웹 환경: Web Serial API 사용
        const connected = await connectBillDispenser()
        if (connected) {
          setIsConnected(true)
          setStatus("연결 완료")

          // Get initial device info
          const statusText = await getStatus()
          const totalCount = await getTotalDispensedCount()

          if (statusText) {
            setStatus(statusText)
          }

          if (totalCount !== null) {
            setTotalDispensed(totalCount)
          }

          setDeviceStatus(getBillDispenserStatus())
        } else {
          setStatus("연결 실패")
          setError("지폐방출기와 연결할 수 없습니다.")
        }
      }
    } catch (error: any) {
      setStatus("연결 실패")
      setError(error.message || "알 수 없는 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Disconnect
  const handleDisconnect = async () => {
    setIsProcessing(true)
    try {
      await disconnectBillDispenser()
      setIsConnected(false)
      setDeviceStatus(null)
      setStatus("연결 해제됨")
      setError("")
    } catch (error: any) {
      setStatus("연결 해제 오류")
      setError(error.message || "연결 해제 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Reset device
  const handleReset = async () => {
    setIsProcessing(true)
    setStatus("리셋 중...")
    try {
      const result = await resetDispenser()
      setStatus(result ? "리셋 완료" : "리셋 실패")
      if (!result) {
        setError("디바이스 리셋에 실패했습니다.")
      }
    } catch (error: any) {
      setStatus("리셋 오류")
      setError(error.message || "리셋 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Dispense bills
  const handleDispenseBills = async () => {
    if (dispenseBillCount < 1 || dispenseBillCount > 250) {
      setError("지폐 수량은 1~250장 사이여야 합니다.")
      return
    }

    setIsProcessing(true)
    setStatus(`${dispenseBillCount}장 방출 중...`)
    try {
      const result = await dispenseBills(dispenseBillCount)
      if (result) {
        setStatus(`${dispenseBillCount}장 방출 명령 전송 완료`)
        setDispensedBills((prev) => [...prev, dispenseBillCount])
        setError("")
      } else {
        setStatus("방출 실패")
        setError("지폐 방출에 실패했습니다.")
      }
    } catch (error: any) {
      setStatus("방출 오류")
      setError(error.message || "방출 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Disable dispenser
  const handleDisableDispenser = async () => {
    setIsProcessing(true)
    setStatus("동작 금지 설정 중...")
    try {
      const result = await disableDispenser()
      setStatus(result ? "동작 금지 설정 완료" : "동작 금지 설정 실패")
      if (!result) {
        setError("동작 금지 설정에 실패했습니다.")
      }
    } catch (error: any) {
      setStatus("동작 금지 설정 오류")
      setError(error.message || "동작 금지 설정 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Enable dispenser
  const handleEnableDispenser = async () => {
    setIsProcessing(true)
    setStatus("동작 금지 해제 중...")
    try {
      const result = await enableDispenser()
      setStatus(result ? "동작 금지 해제 완료" : "동작 금지 해제 실패")
      if (!result) {
        setError("동작 금지 해제에 실패했습니다.")
      }
    } catch (error: any) {
      setStatus("동작 금지 해제 오류")
      setError(error.message || "동작 금지 해제 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Clear dispensed count
  const handleClearDispensedCount = async () => {
    setIsProcessing(true)
    setStatus("배출된 지폐 수 삭제 중...")
    try {
      const result = await clearDispensedCount()
      setStatus(result ? "배출된 지폐 수 삭제 완료" : "배출된 지폐 수 삭제 실패")
      if (result) {
        setDispensedBills([])
      } else {
        setError("배출된 지폐 수 삭제에 실패했습니다.")
      }
    } catch (error: any) {
      setStatus("배출된 지폐 수 삭제 오류")
      setError(error.message || "배출된 지폐 수 삭제 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Get total dispensed count
  const handleGetTotalDispensedCount = async () => {
    setIsProcessing(true)
    setStatus("총 배출 수량 확인 중...")
    try {
      const total = await getTotalDispensedCount()
      if (total !== null) {
        setStatus(`총 배출 수량: ${total.toLocaleString()}장`)
        setTotalDispensed(total)
        setError("")
      } else {
        setStatus("총 배출 수량 확인 실패")
        setError("총 배출 수량을 확인할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("총 배출 수량 확인 오류")
      setError(error.message || "총 배출 수량 확인 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Clear total dispensed count
  const handleClearTotalDispensedCount = async () => {
    setIsProcessing(true)
    setStatus("누적 배출 수량 초기화 중...")
    try {
      const result = await clearTotalDispensedCount()
      if (result) {
        setStatus("누적 배출 수량 초기화 완료")
        setTotalDispensed(0)
        setError("")
      } else {
        setStatus("누적 배출 수량 초기화 실패")
        setError("누적 배출 수량 초기화에 실패했습니다.")
      }
    } catch (error: any) {
      setStatus("누적 배출 수량 초기화 오류")
      setError(error.message || "누적 배출 수량 초기화 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Get status
  const handleGetStatus = async () => {
    setIsProcessing(true)
    setStatus("상태 확인 중...")
    try {
      const statusText = await getStatus()
      if (statusText) {
        setStatus(statusText)
        setError("")
      } else {
        setStatus("상태 확인 실패")
        setError("상태를 확인할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("상태 확인 오류")
      setError(error.message || "상태 확인 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Get error code
  const handleGetErrorCode = async () => {
    setIsProcessing(true)
    setStatus("에러 코드 확인 중...")
    try {
      const errorInfo = await getErrorCode()
      if (errorInfo) {
        setStatus(`에러 코드: 0x${errorInfo.code.toString(16).toUpperCase()} - ${errorInfo.description}`)
        setErrorInfo(errorInfo)
        setError("")
      } else {
        setStatus("에러 코드 확인 실패")
        setError("에러 코드를 확인할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("에러 코드 확인 오류")
      setError(error.message || "에러 코드 확인 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Clear logs
  const handleClearLogs = () => {
    setTxMessages([])
    setRxMessages([])
    clearBillDispenserCommandLog()
  }

  // Handle protocol change
  const handleProtocolChange = (isOld: boolean) => {
    setIsOldProtocol(isOld)
    setProtocolVersion(isOld)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            지폐방출기 테스트 프로그램 (v1.0)
            {isConnected ? (
              <Badge variant="default" className="ml-auto">
                <Wifi className="h-3 w-3 mr-1" />
                연결됨
              </Badge>
            ) : (
              <Badge variant="secondary" className="ml-auto">
                <WifiOff className="h-3 w-3 mr-1" />
                연결 안됨
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Connection & Control */}
            <div className="space-y-6">
              {/* Connection Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Power className="h-5 w-5" />
                    통신 설정
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Com Port</label>
                    <Select value={selectedPort} onValueChange={setSelectedPort} disabled={isConnected}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COM1">COM1</SelectItem>
                        <SelectItem value="COM2">COM2</SelectItem>
                        <SelectItem value="COM3">COM3</SelectItem>
                        <SelectItem value="COM4">COM4</SelectItem>
                        <SelectItem value="COM5">COM5</SelectItem>
                        <SelectItem value="COM6">COM6</SelectItem>
                        <SelectItem value="COM7">COM7</SelectItem>
                        <SelectItem value="COM8">COM8</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="oldProtocol"
                      checked={isOldProtocol}
                      onCheckedChange={(checked) => handleProtocolChange(checked as boolean)}
                      disabled={isConnected}
                    />
                    <label htmlFor="oldProtocol" className="text-sm font-medium">
                      DIP SW3번 의한 Old Protocol로 설정
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={isConnected ? handleDisconnect : handleConnect}
                      disabled={isProcessing}
                      className="flex-1"
                      variant={isConnected ? "destructive" : "default"}
                    >
                      {isConnected ? (
                        <>
                          <PowerOff className="h-4 w-4 mr-2" />
                          RS232 Port Close
                        </>
                      ) : (
                        <>
                          <Power className="h-4 w-4 mr-2" />
                          RS232 Port Open
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="text-xs text-gray-500 space-y-1">
                    <div>• Baud Rate: 9600 bps</div>
                    <div>• Data Bits: 8</div>
                    <div>• Stop Bits: 1</div>
                    <div>• Parity: None</div>
                    <div>• Flow Control: None</div>
                  </div>
                </CardContent>
              </Card>

              {/* Dispenser Control */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Banknote className="h-5 w-5" />
                    Dispenser
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button
                    onClick={handleReset}
                    disabled={!isConnected || isProcessing}
                    className="w-full bg-transparent"
                    variant="outline"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    통신 Check
                  </Button>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-sm font-medium">지폐 배출</label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="1"
                        max="250"
                        value={dispenseBillCount}
                        onChange={(e) => setDispenseBillCount(Number.parseInt(e.target.value) || 1)}
                        disabled={!isConnected || isProcessing}
                        className="w-20"
                      />
                      <Button onClick={handleDispenseBills} disabled={!isConnected || isProcessing} className="flex-1">
                        <Send className="h-4 w-4 mr-2" />
                        배출 지폐 Data 작성
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={handleDisableDispenser}
                      disabled={!isConnected || isProcessing}
                      variant="outline"
                      size="sm"
                    >
                      <Ban className="h-4 w-4 mr-1" />
                      동작 금지 설정
                    </Button>
                    <Button
                      onClick={handleEnableDispenser}
                      disabled={!isConnected || isProcessing}
                      variant="outline"
                      size="sm"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      동작 금지 해제
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Dispenser 초기화 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5" />
                    Dispenser 초기화
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={handleClearDispensedCount}
                      disabled={!isConnected || isProcessing}
                      variant="outline"
                      size="sm"
                    >
                      <Trash className="h-4 w-4 mr-1" />
                      배출 지폐 삭제
                    </Button>
                    <Button
                      onClick={handleClearTotalDispensedCount}
                      disabled={!isConnected || isProcessing}
                      variant="outline"
                      size="sm"
                    >
                      <Trash className="h-4 w-4 mr-1" />
                      누적 지폐 Clear
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={handleGetTotalDispensedCount}
                      disabled={!isConnected || isProcessing}
                      variant="outline"
                      size="sm"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      누적 배출 확인
                    </Button>
                    <Button
                      onClick={handleGetStatus}
                      disabled={!isConnected || isProcessing}
                      variant="outline"
                      size="sm"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      상태 확인
                    </Button>
                  </div>

                  <Button
                    onClick={handleGetErrorCode}
                    disabled={!isConnected || isProcessing}
                    variant="outline"
                    className="w-full bg-transparent"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    에러 코드 확인
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Middle Column - Status & Information */}
            <div className="space-y-6">
              {/* Device Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    동작 상태 [대기 상태]
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">연결 상태:</span>
                      <Badge variant={isConnected ? "default" : "secondary"}>
                        {isConnected ? "연결됨" : "연결 안됨"}
                      </Badge>
                    </div>

                    {deviceStatus && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">현재 상태:</span>
                          <span className="text-sm font-medium">{getStatusString(deviceStatus.currentStatus)}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">배출된 지폐:</span>
                          <span className="text-sm font-medium">{deviceStatus.dispensedCount}장</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">누적 배출:</span>
                          <span className="text-sm font-medium">
                            {totalDispensed !== null
                              ? totalDispensed.toLocaleString()
                              : deviceStatus.totalDispensedCount.toLocaleString()}
                            장
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">프로토콜:</span>
                          <span className="text-sm font-medium">
                            {deviceStatus.isOldProtocol ? "구 프로토콜" : "신 프로토콜"}
                          </span>
                        </div>

                        {deviceStatus.lastErrorCode > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">마지막 에러:</span>
                            <span className="text-sm font-medium text-red-600">
                              0x{deviceStatus.lastErrorCode.toString(16).toUpperCase()}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {status && (
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <div className="text-sm font-medium text-blue-900">{status}</div>
                    </div>
                  )}

                  {error && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {errorInfo && (
                    <div className="p-3 bg-red-50 rounded-lg">
                      <div className="text-sm font-medium text-red-900">
                        에러 코드: 0x{errorInfo.code.toString(16).toUpperCase()}
                      </div>
                      <div className="text-sm text-red-700">{errorInfo.description}</div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Dispensed Bills History */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Download className="h-5 w-5" />
                    배출된 지폐 내역
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {dispensedBills.length === 0 ? (
                      <div className="text-sm text-gray-500 text-center py-4">배출된 지폐가 없습니다</div>
                    ) : (
                      dispensedBills.map((count, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="text-sm">배출 #{index + 1}</span>
                          <Badge variant="outline">{count}장</Badge>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Communication Log */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Send className="h-5 w-5" />
                      RS232 설정 통신 내용
                    </div>
                    <Button onClick={handleClearLogs} size="sm" variant="outline">
                      <Trash className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* TX Messages */}
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        TX
                      </div>
                      <Textarea
                        value={txMessages.join("\n")}
                        readOnly
                        className="h-32 text-xs font-mono"
                        placeholder="송신 메시지가 여기에 표시됩니다..."
                      />
                    </div>

                    {/* RX Messages */}
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        RX
                      </div>
                      <Textarea
                        value={rxMessages.join("\n")}
                        readOnly
                        className="h-32 text-xs font-mono"
                        placeholder="수신 메시지가 여기에 표시됩니다..."
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Banknote,
  Power,
  PowerOff,
  RotateCcw,
  Eye,
  Check,
  X,
  ArrowLeft,
  Download,
  AlertTriangle,
  Wifi,
  WifiOff,
} from "lucide-react"
import {
  connectBillAcceptor,
  disconnectBillAcceptor,
  isBillAcceptorConnected,
  getBillAcceptorStatus,
  getBillAcceptorCommandLog,
  clearBillAcceptorCommandLog,
  getStatus,
  getVersion,
  getConfig,
  setConfig,
  enableAcceptance,
  resetDevice,
  returnBill,
  stackBill,
  getBillData,
  getErrorCode,
  getStatusString,
  getErrorString,
  getLastEventMessage,
  disableAcceptance,
  clearTotalAcceptedAmount,
  clearInsertedAmount,
  setBillCountingCallback,
  sendEventTxCommand,
} from "@/lib/bill-acceptor-utils"
import BillAcceptorDiagnostics from "./bill-acceptor-diagnostics"

interface BillConfig {
  bill1000: boolean
  bill5000: boolean
  bill10000: boolean
  bill50000: boolean
  autoStack: boolean
  eventTx: boolean
}

export default function BillAcceptorTest() {
  const [isConnected, setIsConnected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [deviceStatus, setDeviceStatus] = useState<any>(null)
  const [billConfig, setBillConfig] = useState<BillConfig>({
    bill1000: true,
    bill5000: true,
    bill10000: true,
    bill50000: true,
    autoStack: false,
    eventTx: false,
  })
  // 지폐 개수 추적
  const [billCounts, setBillCounts] = useState({
    bill1000: 0,
    bill5000: 0,
    bill10000: 0,
    bill50000: 0,
  })
  const [totalAmount, setTotalAmount] = useState(0)
  const [currentBillType, setCurrentBillType] = useState<number>(0)
  const [txMessages, setTxMessages] = useState<string[]>([])
  const [rxMessages, setRxMessages] = useState<string[]>([])
  const [autoMode, setAutoMode] = useState(false)
  const [selectedPort, setSelectedPort] = useState("COM4")
  const [lastEvent, setLastEvent] = useState<any>(null)

  // Update connection status and device info
  useEffect(() => {
    // 지폐 카운팅 콜백 설정
    setBillCountingCallback((amount: number) => {
      updateBillCount(amount)
    })

    const interval = setInterval(async () => {
      const connected = isBillAcceptorConnected()
      setIsConnected(connected)

      if (connected) {
        const status = getBillAcceptorStatus()
        setDeviceStatus(status)

        // 마지막 이벤트 메시지 확인
        const eventMessage = getLastEventMessage()
        if (eventMessage) {
          setLastEvent(eventMessage)
        }

        // Update command log
        const commandLog = getBillAcceptorCommandLog()
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

  // Connect to bill acceptor
  const handleConnect = async () => {
    setIsProcessing(true)
    setStatus("지폐인식기에 연결 중...")
    setError("")

    try {
      const connected = await connectBillAcceptor()
      if (connected) {
        setIsConnected(true)
        setStatus("연결 완료")

        // Get initial device info
        const config = await getConfig()
        const currentStatus = await getStatus()

        setDeviceStatus({
          ...getBillAcceptorStatus(),
          config,
          currentStatus,
        })

        // Parse config to update checkboxes
        if (config !== null) {
          setBillConfig({
            bill1000: (config & 0x01) !== 0,
            bill5000: (config & 0x02) !== 0,
            bill10000: (config & 0x04) !== 0,
            bill50000: (config & 0x08) !== 0,
            autoStack: (config & 0x10) !== 0,
            eventTx: (config & 0x20) !== 0,
          })
        }
      } else {
        setStatus("연결 실패")
        setError("지폐인식기와 연결할 수 없습니다.")
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
      await disconnectBillAcceptor()
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
      const result = await resetDevice()
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

  // Version check
  const handleVersionCheck = async () => {
    setIsProcessing(true)
    setStatus("버전 확인 중...")
    try {
      const version = await getVersion()
      if (version) {
        setStatus(`펌웨어 버전: v${version.major}.${version.minor}`)
        setError("")
      } else {
        setStatus("버전 확인 실패")
        setError("펌웨어 버전을 확인할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("버전 확인 오류")
      setError(error.message || "버전 확인 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Read config
  const handleReadConfig = async () => {
    setIsProcessing(true)
    setStatus("설정 읽는 중...")
    try {
      const config = await getConfig()
      if (config !== null) {
        setBillConfig({
          bill1000: (config & 0x01) !== 0,
          bill5000: (config & 0x02) !== 0,
          bill10000: (config & 0x04) !== 0,
          bill50000: (config & 0x08) !== 0,
          autoStack: (config & 0x10) !== 0,
          eventTx: (config & 0x20) !== 0,
        })
        setStatus(`설정 읽기 완료: 0x${config.toString(16).padStart(2, "0")}`)
        setError("")
      } else {
        setStatus("설정 읽기 실패")
        setError("디바이스 설정을 읽을 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("설정 읽기 오류")
      setError(error.message || "설정 읽기 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Set config
  const handleSetConfig = async () => {
    setIsProcessing(true)
    setStatus("설정 저장 중...")
    try {
      let configValue = 0
      if (billConfig.bill1000) configValue |= 0x01
      if (billConfig.bill5000) configValue |= 0x02
      if (billConfig.bill10000) configValue |= 0x04
      if (billConfig.bill50000) configValue |= 0x08
      if (billConfig.autoStack) configValue |= 0x10
      if (billConfig.eventTx) configValue |= 0x20

      const result = await setConfig(configValue)
      if (result) {
        setStatus(`설정 저장 완료: 0x${configValue.toString(16).padStart(2, "0")}`)
        setError("")
      } else {
        setStatus("설정 저장 실패")
        setError("디바이스 설정을 저장할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("설정 저장 오류")
      setError(error.message || "설정 저장 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Read status
  const handleReadStatus = async () => {
    setIsProcessing(true)
    setStatus("상태 확인 중...")
    try {
      const currentStatus = await getStatus()
      if (currentStatus !== null) {
        setStatus(`현재 상태: ${getStatusString(currentStatus)}`)
        setError("")

        // If error status, get error details
        if (currentStatus === 0x0c) {
          const errorCode = await getErrorCode()
          if (errorCode !== null) {
            setStatus(`오류 상태: ${getErrorString(errorCode)}`)
            setError(`오류 코드: ${errorCode} - ${getErrorString(errorCode)}`)
          }
        }
      } else {
        setStatus("상태 확인 실패")
        setError("디바이스 상태를 확인할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("상태 확인 오류")
      setError(error.message || "상태 확인 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Enable acceptance
  const handleEnableAcceptance = async () => {
    setIsProcessing(true)
    setStatus("입수 가능 설정 중...")
    try {
      const result = await enableAcceptance()
      if (result) {
        setStatus("입수 가능 상태로 변경됨")
        setError("")
      } else {
        setStatus("입수 가능 설정 실패")
        setError("지폐 수취를 활성화할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("입수 가능 설정 오류")
      setError(error.message || "입수 가능 설정 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Return bill
  const handleReturnBill = async () => {
    setIsProcessing(true)
    setStatus("지폐 반환 중...")
    try {
      const result = await returnBill()
      if (result) {
        setStatus("지폐 반환 완료")
        setError("")
      } else {
        setStatus("지폐 반환 실패")
        setError("지폐를 반환할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("지폐 반환 오류")
      setError(error.message || "지폐 반환 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Stack bill
  const handleStackBill = async () => {
    setIsProcessing(true)
    setStatus("지폐 적재 중...")
    try {
      const result = await stackBill()
      if (result) {
        setStatus("지폐 적재 완료")
        updateBillCount(currentBillType)
        setError("")
      } else {
        setStatus("지폐 적재 실패")
        setError("지폐를 적재할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("지폐 적재 오류")
      setError(error.message || "지폐 적재 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Check bill type
  const handleCheckBillType = async () => {
    setIsProcessing(true)
    setStatus("지폐 종류 확인 중...")
    try {
      const billData = await getBillData()
      if (billData !== null) {
        let amount = 0
        switch (billData) {
          case 1:
            amount = 1000
            break
          case 5:
            amount = 5000
            break
          case 10:
            amount = 10000
            break
          case 50:
            amount = 50000
            break
        }
        setCurrentBillType(amount)
        setStatus(`지폐 종류: ${amount.toLocaleString()}원`)
        setError("")
      } else {
        setStatus("지폐 종류 확인 실패")
        setError("지폐 종류를 확인할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("지폐 종류 확인 오류")
      setError(error.message || "지폐 종류 확인 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Clear messages
  const handleClearMessages = () => {
    setTxMessages([])
    setRxMessages([])
    clearBillAcceptorCommandLog()
    setStatus("메시지 로그 초기화됨")
    setError("")
  }

  // 입수총액 지움
  const handleClearTotalAmount = () => {
    setBillCounts({
      bill1000: 0,
      bill5000: 0,
      bill10000: 0,
      bill50000: 0,
    })
    setTotalAmount(0)
    setStatus("입수총액이 초기화되었습니다")
  }

  // 입수 금지
  const handleProhibitAcceptance = async () => {
    setIsProcessing(true)
    setStatus("입수 금지 설정 중...")
    try {
      const result = await disableAcceptance()
      setStatus(result ? "입수 금지 설정됨" : "입수 금지 설정 실패")
    } catch (error: any) {
      setStatus("입수 금지 설정 오류")
      setError(error.message || "입수 금지 설정 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // 지폐 입수 시 개수 업데이트
  const updateBillCount = (amount: number) => {
    setBillCounts((prev) => {
      const newCounts = { ...prev }
      switch (amount) {
        case 1000:
          newCounts.bill1000++
          break
        case 5000:
          newCounts.bill5000++
          break
        case 10000:
          newCounts.bill10000++
          break
        case 50000:
          newCounts.bill50000++
          break
      }
      return newCounts
    })
    setTotalAmount((prev) => prev + amount)
  }

  // 입수총액 지움 (하드웨어 명령)
  const handleClearTotalAmountHardware = async () => {
    setIsProcessing(true)
    setStatus("입수총액 지우는 중...")
    try {
      const result = await clearTotalAcceptedAmount()
      if (result) {
        setBillCounts({
          bill1000: 0,
          bill5000: 0,
          bill10000: 0,
          bill50000: 0,
        })
        setTotalAmount(0)
        setStatus("입수총액이 초기화되었습니다")
      } else {
        setStatus("입수총액 초기화 실패")
      }
    } catch (error: any) {
      setStatus("입수총액 초기화 오류")
      setError(error.message || "입수총액 초기화 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // 투입금 지움
  const handleClearInsertedAmount = async () => {
    setIsProcessing(true)
    setStatus("투입금 지우는 중...")
    try {
      const result = await clearInsertedAmount()
      setStatus(result ? "투입금이 초기화되었습니다" : "투입금 초기화 실패")
    } catch (error: any) {
      setStatus("투입금 초기화 오류")
      setError(error.message || "투입금 초기화 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Send Event TX command
  const handleSendEventTx = async () => {
    setIsProcessing(true)
    setStatus("Event TX 명령 전송 중...")
    try {
      const result = await sendEventTxCommand()
      if (result) {
        setStatus("Event TX 명령 전송 성공")
        setError("")
      } else {
        setStatus("Event TX 명령 전송 실패")
        setError("Event TX 명령을 전송할 수 없습니다.")
      }
    } catch (error: any) {
      setStatus("Event TX 명령 전송 오류")
      setError(error.message || "Event TX 명령 전송 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            지폐인식기 테스트 프로그램 (v1.0)
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
          <Tabs defaultValue="test" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="test">테스트</TabsTrigger>
              <TabsTrigger value="diagnostics">진단</TabsTrigger>
            </TabsList>

            <TabsContent value="test" className="space-y-4">
              {/* Error Alert */}
              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Browser Compatibility Check */}
              {!("serial" in navigator) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    이 브라우저는 Web Serial API를 지원하지 않습니다. Chrome 89+ 또는 Edge 89+를 사용해주세요.
                  </AlertDescription>
                </Alert>
              )}

              {/* 상단: COM Port 선택과 OPEN 버튼 */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm">포트:</span>
                <Select value={selectedPort} onValueChange={setSelectedPort}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COM4">COM4</SelectItem>
                    <SelectItem value="COM3">COM3</SelectItem>
                    <SelectItem value="COM2">COM2</SelectItem>
                    <SelectItem value="COM1">COM1</SelectItem>
                  </SelectContent>
                </Select>
                {!isConnected ? (
                  <Button size="sm" onClick={handleConnect} disabled={isProcessing || !("serial" in navigator)}>
                    <Power className="h-4 w-4 mr-1" />
                    {isProcessing ? "연결 중..." : "OPEN"}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={isProcessing}>
                    <PowerOff className="h-4 w-4 mr-1" />
                    CLOSE
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Connection & Configuration */}
                <div className="space-y-4">
                  {/* Device Control */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">지폐인식기</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-1 gap-2">
                        <Button size="sm" onClick={handleReset} disabled={!isConnected || isProcessing}>
                          <RotateCcw className="h-4 w-4 mr-1" />
                          RESET
                        </Button>
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={handleVersionCheck}
                          disabled={!isConnected || isProcessing}
                        >
                          Version Check
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Configuration */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">지폐 인식기 Configuration</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="eventTx"
                            checked={billConfig.eventTx}
                            onCheckedChange={(checked) => setBillConfig((prev) => ({ ...prev, eventTx: !!checked }))}
                            disabled={isProcessing}
                          />
                          <label htmlFor="eventTx" className="text-sm">
                            Event발생시 Data TX
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="autoStack"
                            checked={billConfig.autoStack}
                            onCheckedChange={(checked) => setBillConfig((prev) => ({ ...prev, autoStack: !!checked }))}
                            disabled={isProcessing}
                          />
                          <label htmlFor="autoStack" className="text-sm">
                            지폐인식후 자동 Stack
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="bill50000"
                            checked={billConfig.bill50000}
                            onCheckedChange={(checked) => setBillConfig((prev) => ({ ...prev, bill50000: !!checked }))}
                            disabled={isProcessing}
                          />
                          <label htmlFor="bill50000" className="text-sm">
                            50,000원 입수 가능
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="bill10000"
                            checked={billConfig.bill10000}
                            onCheckedChange={(checked) => setBillConfig((prev) => ({ ...prev, bill10000: !!checked }))}
                            disabled={isProcessing}
                          />
                          <label htmlFor="bill10000" className="text-sm">
                            10,000원 입수 가능
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="bill5000"
                            checked={billConfig.bill5000}
                            onCheckedChange={(checked) => setBillConfig((prev) => ({ ...prev, bill5000: !!checked }))}
                            disabled={isProcessing}
                          />
                          <label htmlFor="bill5000" className="text-sm">
                            5,000원 입수 가능
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="bill1000"
                            checked={billConfig.bill1000}
                            onCheckedChange={(checked) => setBillConfig((prev) => ({ ...prev, bill1000: !!checked }))}
                            disabled={isProcessing}
                          />
                          <label htmlFor="bill1000" className="text-sm">
                            1,000원 입수 가능
                          </label>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" onClick={handleReadConfig} disabled={!isConnected || isProcessing}>
                          Read Config
                        </Button>
                        <Button size="sm" onClick={handleSetConfig} disabled={!isConnected || isProcessing}>
                          Set Config
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Center Column - 지폐 개수 표시 */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">지폐 개수</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm">천원권: {billCounts.bill1000}</p>
                          <p className="text-sm">만원권: {billCounts.bill10000}</p>
                        </div>
                        <div>
                          <p className="text-sm">오천원권: {billCounts.bill5000}</p>
                          <p className="text-sm">오만원권: {billCounts.bill50000}</p>
                        </div>
                      </div>
                      <p className="text-sm mt-4">총 입수액: {totalAmount.toLocaleString()}원</p>
                      <Button size="sm" variant="outline" onClick={handleClearTotalAmount}>
                        입수총액 지움
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Column - Bill Control */}
                <div className="space-y-4">
                  {/* Device Status */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">지폐 인식기 상태</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {deviceStatus && (
                        <div className="bg-gray-50 p-3 rounded">
                          <p className="text-sm">
                            <strong>상태:</strong> {getStatusString(deviceStatus.currentStatus)}
                          </p>
                          {deviceStatus.version && (
                            <p className="text-sm">
                              <strong>버전:</strong> v{deviceStatus.version.major}.{deviceStatus.version.minor}
                            </p>
                          )}
                          <p className="text-sm">
                            <strong>수취:</strong> {deviceStatus.accepting ? "활성화" : "비활성화"}
                          </p>
                          {lastEvent && (
                            <p className="text-sm">
                              <strong>마지막 이벤트:</strong> {getStatusString(lastEvent.data)} (
                              {new Date(lastEvent.timestamp).toLocaleTimeString()})
                            </p>
                          )}
                        </div>
                      )}
                      <Button size="sm" onClick={handleReadStatus} disabled={!isConnected || isProcessing}>
                        <Eye className="h-4 w-4 mr-1" />
                        Read Status
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Bill Input Control */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">수동 제어</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="auto"
                          checked={autoMode}
                          onCheckedChange={(checked) => setAutoMode(!!checked)}
                          disabled={isProcessing}
                        />
                        <label htmlFor="auto" className="text-sm">
                          Auto
                        </label>
                      </div>

                      <div className="bg-gray-50 p-3 rounded">
                        <p className="text-sm font-medium">현재 지폐:</p>
                        <p className="text-lg font-bold">
                          {currentBillType > 0 ? `${currentBillType.toLocaleString()}원` : "없음"}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-2">
                        <Button size="sm" onClick={handleCheckBillType} disabled={!isConnected || isProcessing}>
                          <Eye className="h-4 w-4 mr-1" />
                          지폐 종류 확인
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* 하단: Read Status, 오류 내용, 입수 관련 버튼들 */}
              <Separator className="my-6" />
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <Button size="sm" onClick={handleReadStatus} disabled={!isConnected || isProcessing}>
                  오류 내용
                </Button>
                <Button size="sm" onClick={handleClearTotalAmountHardware} disabled={!isConnected || isProcessing}>
                  입수총액 지움
                </Button>
                <Button size="sm" onClick={handleEnableAcceptance} disabled={!isConnected || isProcessing}>
                  <Check className="h-4 w-4 mr-1" />
                  입수 가능
                </Button>
                <Button size="sm" onClick={handleProhibitAcceptance} disabled={!isConnected || isProcessing}>
                  입수 금지
                </Button>
                <Button size="sm" onClick={handleReturnBill} disabled={!isConnected || isProcessing}>
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  입수 반환
                </Button>
                <Button size="sm" onClick={handleStackBill} disabled={!isConnected || isProcessing}>
                  <Download className="h-4 w-4 mr-1" />
                  독립금 지출
                </Button>
                <Button size="sm" onClick={handleClearInsertedAmount} disabled={!isConnected || isProcessing}>
                  투입금 지움
                </Button>
                <Button size="sm" onClick={handleSendEventTx} disabled={!isConnected || isProcessing}>
                  Event TX
                </Button>
              </div>

              {/* 최하단: RS232 Message 로그 */}
              <Separator className="my-6" />
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm">RS232 Message</CardTitle>
                    <Button size="sm" variant="outline" onClick={handleClearMessages}>
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium mb-2">TX:</p>
                      <Textarea
                        value={txMessages.join("\n")}
                        readOnly
                        className="h-32 font-mono text-xs"
                        placeholder="송신 메시지가 여기에 표시됩니다..."
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-2">RX:</p>
                      <Textarea
                        value={rxMessages.join("\n")}
                        readOnly
                        className="h-32 font-mono text-xs"
                        placeholder="수신 메시지가 여기에 표시됩니다..."
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="diagnostics">
              <BillAcceptorDiagnostics />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

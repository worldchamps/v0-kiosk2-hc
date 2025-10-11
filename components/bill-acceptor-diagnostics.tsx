"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckCircle, XCircle, RefreshCw, Monitor, Settings, HelpCircle } from "lucide-react"
import { getBillAcceptorDiagnostics } from "@/lib/bill-acceptor-utils"

export default function BillAcceptorDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)

  const runDiagnostics = async () => {
    setIsLoading(true)
    try {
      const result = await getBillAcceptorDiagnostics()
      setDiagnostics(result)
    } catch (error) {
      console.error("진단 실행 오류:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    runDiagnostics()
  }, [])

  const getStatusIcon = (status: boolean) => {
    return status ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              지폐인식기 진단 도구
            </CardTitle>
            <Button onClick={runDiagnostics} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              진단 실행
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!diagnostics ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
              <p className="mt-2 text-gray-600">진단 실행 중...</p>
            </div>
          ) : (
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">개요</TabsTrigger>
                <TabsTrigger value="settings">설정</TabsTrigger>
                <TabsTrigger value="logs">로그</TabsTrigger>
                <TabsTrigger value="troubleshooting">문제해결</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">포트 상태</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span>포트 사용 가능</span>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(diagnostics.portDiagnosis.available)}
                        <Badge variant={diagnostics.portDiagnosis.available ? "default" : "destructive"}>
                          {diagnostics.portDiagnosis.available ? "사용 가능" : "사용 불가"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>포트 사용 중</span>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(!diagnostics.portDiagnosis.inUse)}
                        <Badge variant={diagnostics.portDiagnosis.inUse ? "destructive" : "default"}>
                          {diagnostics.portDiagnosis.inUse ? "사용 중" : "사용 가능"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>권한</span>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(diagnostics.portDiagnosis.permissions)}
                        <Badge variant={diagnostics.portDiagnosis.permissions ? "default" : "destructive"}>
                          {diagnostics.portDiagnosis.permissions ? "정상" : "권한 없음"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">진단 세부사항</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {diagnostics.portDiagnosis.details.map((detail: string, index: number) => (
                        <div key={index} className="text-sm font-mono bg-gray-50 p-2 rounded">
                          {detail}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="h-5 w-5" />
                      연결 설정 검증
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {diagnostics.connectionSettings.details.map((detail: string, index: number) => (
                        <div key={index} className="text-sm bg-gray-50 p-2 rounded">
                          {detail}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logs" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">연결 로그</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={diagnostics.connectionLog
                          .map((log: any) => `[${log.timestamp}] ${log.event}: ${log.details}`)
                          .join("\n")}
                        readOnly
                        className="h-64 font-mono text-xs"
                        placeholder="연결 로그가 여기에 표시됩니다..."
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">명령 로그</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={diagnostics.commandLog
                          .map((log: any) => {
                            const bytes = log.bytes.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")
                            const response = log.response
                              ? log.response.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")
                              : "N/A"
                            return `[${log.timestamp}] ${log.command}: ${bytes} -> ${response}${log.error ? ` ERROR: ${log.error}` : ""}`
                          })
                          .join("\n")}
                        readOnly
                        className="h-64 font-mono text-xs"
                        placeholder="명령 로그가 여기에 표시됩니다..."
                      />
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="troubleshooting" className="space-y-4">
                <Alert>
                  <HelpCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>COM4 포트 연결 문제 해결 가이드</strong>
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">1. 물리적 연결 확인</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p>
                        • <strong>RS-232 케이블 연결:</strong>
                      </p>
                      <p className="ml-4">- Pin 1 (RX): 지폐인식기 → PC</p>
                      <p className="ml-4">- Pin 2 (TX): PC → 지폐인식기</p>
                      <p className="ml-4">- Pin 3 (GND): 공통 접지</p>
                      <p>
                        • <strong>전원 확인:</strong> DC 12V 또는 24V (±5%)
                      </p>
                      <p>
                        • <strong>케이블 상태:</strong> 손상되지 않은 RS-232 케이블 사용
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">2. Windows 장치 관리자 설정</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p>
                        • <strong>장치 관리자 열기:</strong> Win + X → 장치 관리자
                      </p>
                      <p>
                        • <strong>포트 확인:</strong> 포트(COM & LPT) → COM4
                      </p>
                      <p>
                        • <strong>속성 설정:</strong> COM4 우클릭 → 속성 → 포트 설정
                      </p>
                      <p className="ml-4">- 초당 비트: 9600</p>
                      <p className="ml-4">- 데이터 비트: 8</p>
                      <p className="ml-4">- 패리티: 없음</p>
                      <p className="ml-4">- 정지 비트: 1</p>
                      <p className="ml-4">- 흐름 제어: 없음</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">3. 포트 사용 중 문제</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p>
                        • <strong>작업 관리자 확인:</strong> COM4를 사용하는 다른 프로그램 종료
                      </p>
                      <p>
                        • <strong>일반적인 프로그램:</strong>
                      </p>
                      <p className="ml-4">- 터미널 에뮬레이터 (PuTTY, Tera Term 등)</p>
                      <p className="ml-4">- 다른 키오스크 프로그램</p>
                      <p className="ml-4">- 시리얼 모니터링 도구</p>
                      <p>
                        • <strong>시스템 재시작:</strong> 필요시 PC 재시작
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">4. 브라우저 권한 문제</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p>
                        • <strong>브라우저 버전:</strong> Chrome 89+ 또는 Edge 89+ 사용
                      </p>
                      <p>
                        • <strong>HTTPS 필요:</strong> 로컬에서는 localhost, 배포 시 HTTPS
                      </p>
                      <p>
                        • <strong>관리자 권한:</strong> 브라우저를 관리자 권한으로 실행
                      </p>
                      <p>
                        • <strong>포트 권한:</strong> 연결 버튼 클릭 시 포트 선택 허용
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">5. 터미널 테스트</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p>
                        • <strong>PuTTY 사용:</strong>
                      </p>
                      <p className="ml-4">1. Connection Type: Serial</p>
                      <p className="ml-4">2. Serial line: COM4</p>
                      <p className="ml-4">3. Speed: 9600</p>
                      <p className="ml-4">4. 연결 후 "$HT?" 입력 (연결 테스트)</p>
                      <p className="ml-4">5. 응답: "$ht?" 수신 시 정상</p>
                      <p>
                        • <strong>테스트 명령어:</strong>
                      </p>
                      <p className="ml-4">- 연결 테스트: $HT?</p>
                      <p className="ml-4">- 상태 확인: $GA?</p>
                      <p className="ml-4">- 버전 확인: $GV?</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">6. 일반적인 오류 메시지</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p>
                        • <strong>"Access denied":</strong> 다른 프로그램이 포트 사용 중
                      </p>
                      <p>
                        • <strong>"Network error":</strong> 물리적 연결 또는 전원 문제
                      </p>
                      <p>
                        • <strong>"Port not found":</strong> COM4 포트가 존재하지 않음
                      </p>
                      <p>
                        • <strong>"Permission denied":</strong> 브라우저 권한 부족
                      </p>
                      <p>
                        • <strong>"Timeout":</strong> 지폐인식기 응답 없음 (전원/케이블 확인)
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

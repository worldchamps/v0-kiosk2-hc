"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, RefreshCw, Printer, Banknote, DollarSign } from "lucide-react"

interface DeviceStatus {
  name: string
  port: string
  connected: boolean
  icon: React.ReactNode
  details?: string
}

export default function DeviceStatus() {
  const [devices, setDevices] = useState<DeviceStatus[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const checkDeviceStatus = async () => {
    setIsLoading(true)

    try {
      const statuses: DeviceStatus[] = []

      if (typeof window !== "undefined" && window.electronAPI?.getPrinterStatus) {
        const printerStatus = await window.electronAPI.getPrinterStatus()
        statuses.push({
          name: "프린터",
          port: "COM2",
          connected: printerStatus?.connected || false,
          icon: <Printer className="h-5 w-5" />,
          details: printerStatus?.connected ? "정상 작동 중" : "연결되지 않음",
        })
      } else {
        statuses.push({
          name: "프린터",
          port: "COM2",
          connected: false,
          icon: <Printer className="h-5 w-5" />,
          details: "Electron 환경에서만 사용 가능",
        })
      }

      if (typeof window !== "undefined" && window.electronAPI?.getBillAcceptorStatus) {
        const acceptorStatus = await window.electronAPI.getBillAcceptorStatus()
        statuses.push({
          name: "지폐 인식기",
          port: "COM4",
          connected: acceptorStatus?.connected || false,
          icon: <Banknote className="h-5 w-5" />,
          details: acceptorStatus?.connected ? "정상 작동 중" : "연결되지 않음",
        })
      } else {
        statuses.push({
          name: "지폐 인식기",
          port: "COM4",
          connected: false,
          icon: <Banknote className="h-5 w-5" />,
          details: "Electron 환경에서만 사용 가능",
        })
      }

      if (typeof window !== "undefined" && window.electronAPI?.getBillDispenserStatus) {
        const dispenserStatus = await window.electronAPI.getBillDispenserStatus()
        statuses.push({
          name: "지폐 방출기",
          port: "COM5",
          connected: dispenserStatus?.connected || false,
          icon: <DollarSign className="h-5 w-5" />,
          details: dispenserStatus?.connected ? "정상 작동 중" : "연결되지 않음",
        })
      } else {
        statuses.push({
          name: "지폐 방출기",
          port: "COM5",
          connected: false,
          icon: <DollarSign className="h-5 w-5" />,
          details: "Electron 환경에서만 사용 가능",
        })
      }

      setDevices(statuses)
    } catch (error) {
      console.error("장치 상태 확인 오류:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    checkDeviceStatus()
    const interval = setInterval(checkDeviceStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">외부 기기 연결 상태</h2>
        <Button onClick={checkDeviceStatus} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          새로고침
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {devices.map((device, index) => (
          <Card key={index}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {device.icon}
                {device.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">포트</span>
                <Badge variant="outline">{device.port}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">상태</span>
                <div className="flex items-center gap-2">
                  {device.connected ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <Badge variant={device.connected ? "default" : "destructive"}>
                    {device.connected ? "연결됨" : "연결 안됨"}
                  </Badge>
                </div>
              </div>
              {device.details && <div className="text-sm text-gray-600 pt-2 border-t">{device.details}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>연결 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            • <strong>Property 3, 4</strong>에서만 외부 기기가 자동으로 연결됩니다.
          </p>
          <p>
            • <strong>Property 1, 2</strong>는 팝업 모드로 작동하여 외부 기기를 사용하지 않습니다.
          </p>
          <p>• 장치 연결 상태는 5초마다 자동으로 업데이트됩니다.</p>
          <p>• Electron 앱에서만 COM 포트 연결이 가능합니다.</p>
        </CardContent>
      </Card>
    </div>
  )
}

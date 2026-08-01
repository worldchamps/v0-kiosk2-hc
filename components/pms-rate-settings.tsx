"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Server } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PmsRateProperty, PmsRateRoom } from "@/lib/pms-rates"
import type { PropertyId } from "@/lib/property-utils"

const PROPERTY_LABELS: Record<PropertyId, string> = {
  property1: "비치스테이 C·D동",
  property2: "카리브",
  property3: "비치스테이 A·B동",
  property4: "캠프",
}

function formatAmount(amount: number) {
  return amount > 0 ? `${amount.toLocaleString("ko-KR")}원` : "-"
}

function RateCell({ room, kind }: { room: PmsRateRoom; kind: "overnight" | "shortStay" }) {
  const rates = room.rates[kind]

  return (
    <div className="min-w-36 space-y-1">
      <div>카드 {formatAmount(rates.card)}</div>
      <div>현금 {formatAmount(rates.cash)}</div>
    </div>
  )
}

export default function PmsRateSettings() {
  const [selectedProperty, setSelectedProperty] = useState<PropertyId>("property1")
  const [properties, setProperties] = useState<PmsRateProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const loadRates = useCallback(async () => {
    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/pms-rates", { cache: "no-store" })
      if (!response.ok) throw new Error(`PMS rate request failed (${response.status})`)
      const data = await response.json()
      setProperties(data.properties ?? [])
    } catch (loadError) {
      console.error("[PMS rates] Failed to load:", loadError)
      setError("Firebase의 PMS 요금을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRates()
  }, [loadRates])

  const selected = properties.find((property) => property.property === selectedProperty)
  const rooms = useMemo(
    () =>
      [...(selected?.rooms ?? [])].sort((a, b) =>
        a.room.localeCompare(b.room, "ko", { numeric: true }),
      ),
    [selected],
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            PMS 요금 관리
          </CardTitle>
          <Button type="button" variant="outline" onClick={loadRates} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          이 화면의 요금은 PMS 프로그램에 직접 접속하지 않고 Firebase Realtime Database의{" "}
          <code>pms_status</code>에서 읽습니다. 0원 또는 없는 값은 “-”로 표시됩니다.
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label htmlFor="pms-property" className="font-medium">
            숙소
          </label>
          <select
            id="pms-property"
            className="h-10 min-w-64 rounded-md border bg-white px-3"
            value={selectedProperty}
            onChange={(event) => setSelectedProperty(event.target.value as PropertyId)}
          >
            {Object.entries(PROPERTY_LABELS).map(([property, label]) => (
              <option key={property} value={property}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-sm text-gray-500">
            Firebase 갱신 시각: {selected?.timestamp ?? "정보 없음"}
          </span>
        </div>

        {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

        {!error && !loading && rooms.length === 0 && (
          <div className="rounded-md bg-gray-50 p-8 text-center text-gray-600">
            이 숙소의 PMS 요금 데이터가 없습니다.
          </div>
        )}

        {!error && rooms.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3">객실</th>
                  <th className="px-4 py-3">객실 타입</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">숙박 요금</th>
                  <th className="px-4 py-3">대실 요금</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room, index) => (
                  <tr key={`${room.room}-${room.roomType}-${index}`} className="border-t">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">{room.room || "-"}</td>
                    <td className="px-4 py-3">{room.roomType || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3">{room.status || "-"}</td>
                    <td className="px-4 py-3">
                      <RateCell room={room} kind="overnight" />
                    </td>
                    <td className="px-4 py-3">
                      <RateCell room={room} kind="shortStay" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

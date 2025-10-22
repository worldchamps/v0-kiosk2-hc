"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"
import { getPropertyDisplayName } from "@/lib/property-utils"
import type { PropertyId } from "@/lib/property-utils"

interface PropertyMismatchDialogProps {
  reservationProperty: PropertyId
  kioskProperty: PropertyId
  onClose: () => void
  onAdminOverride: () => void
}

export default function PropertyMismatchDialog({
  reservationProperty,
  kioskProperty,
  onClose,
  onAdminOverride,
}: PropertyMismatchDialogProps) {
  const correctPropertyName = getPropertyDisplayName(reservationProperty)
  const currentPropertyName = getPropertyDisplayName(kioskProperty)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 p-8">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-12 h-12 text-amber-600" />
          </div>

          <div className="space-y-3">
            <h2 className="text-3xl font-bold text-gray-900">잘못된 키오스크입니다</h2>
            <p className="text-xl text-gray-700 leading-relaxed">이 예약은 다른 키오스크에서만 체크인이 가능합니다.</p>
          </div>

          <div className="w-full bg-gray-50 rounded-xl p-6 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">현재 키오스크:</span>
              <span className="text-lg font-bold text-gray-900">{currentPropertyName}</span>
            </div>
            <div className="h-px bg-gray-200" />
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">체크인 가능 키오스크:</span>
              <span className="text-lg font-bold text-blue-600">{correctPropertyName}</span>
            </div>
          </div>

          <p className="text-gray-600">올바른 키오스크로 이동하여 다시 시도해 주세요.</p>

          <div className="flex gap-4 w-full pt-4">
            <Button onClick={onClose} className="flex-1 h-14 text-lg bg-transparent" variant="outline">
              확인
            </Button>
            <Button onClick={onAdminOverride} className="flex-1 h-14 text-lg bg-amber-600 hover:bg-amber-700">
              관리자 권한으로 진행
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ArrowRight } from "lucide-react"
import type { PropertyId } from "@/lib/property-utils"
import Image from "next/image"

interface PropertyRedirectDialogProps {
  targetProperty: PropertyId
  guestName: string
  onClose: () => void
}

/**
 * Property별 건물 이미지와 안내 메시지 매핑
 */
function getPropertyRedirectInfo(property: PropertyId) {
  const info = {
    property1: {
      image: "/building-c-zoom.png",
      buildingName: "더 비치스테이 C동",
      message: "체크인은 C동 키오스크에서 확인해주시기 바랍니다.",
    },
    property2: {
      image: "/building-c-zoom.png", // Kariv는 별도 이미지가 없으므로 임시로 C동 사용
      buildingName: "Kariv Hotel",
      message: "체크인은 Kariv Hotel 키오스크에서 확인해주시기 바랍니다.",
    },
    property3: {
      image: "/building-a-zoom.png",
      buildingName: "더 비치스테이 A/B동",
      message: "체크인은 A/B동 키오스크에서 확인해주시기 바랍니다.",
    },
    property4: {
      image: "/building-camp-zoom.png",
      buildingName: "더 캠프스테이",
      message: "체크인은 캠프스테이 키오스크에서 확인해주시기 바랍니다.",
    },
  }

  return info[property]
}

export default function PropertyRedirectDialog({ targetProperty, guestName, onClose }: PropertyRedirectDialogProps) {
  const redirectInfo = getPropertyRedirectInfo(targetProperty)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4 p-8">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* 건물 이미지 */}
          <div className="w-full max-w-2xl h-96 relative rounded-xl overflow-hidden border-4 border-blue-500">
            <Image
              src={redirectInfo.image || "/placeholder.svg"}
              alt={redirectInfo.buildingName}
              fill
              className="object-contain"
              priority
            />
          </div>

          {/* 안내 메시지 */}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <h2 className="text-4xl font-bold text-gray-900">{guestName}님</h2>
              <ArrowRight className="w-8 h-8 text-blue-600" />
              <h2 className="text-4xl font-bold text-blue-600">{redirectInfo.buildingName}</h2>
            </div>

            <p className="text-3xl font-bold text-gray-900">{redirectInfo.buildingName}으로 배정되었습니다.</p>

            <p className="text-2xl text-gray-700 leading-relaxed">{redirectInfo.message}</p>
          </div>

          {/* 확인 버튼 */}
          <div className="w-full pt-6">
            <Button onClick={onClose} className="w-full h-20 text-2xl bg-blue-600 hover:bg-blue-700 font-bold">
              확인
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

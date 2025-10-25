"use client"

import { Button } from "@/components/ui/button"
import Image from "next/image"
import { type KioskLocation, getLocationMapPath, getLocationTitle } from "@/lib/location-utils"

interface CurrentLocationProps {
  onNavigate: (screen: string) => void
  kioskLocation: KioskLocation
}

export default function CurrentLocation({ onNavigate, kioskLocation }: CurrentLocationProps) {
  // 위치에 따른 지도 이미지 경로
  const mapImagePath = getLocationMapPath(kioskLocation)

  // 위치에 따른 제목
  const locationTitle = getLocationTitle(kioskLocation)

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">더 비치스테이</h1>
          <div className="kiosk-highlight">현재 위치</div>
        </div>

        <div className="w-full mt-8">
          <div className="bg-white rounded-2xl p-8 shadow-md mb-10">
            <div className="bg-gray-100 rounded-lg w-full h-[60vh] relative overflow-hidden p-0">
              <Image
                src={mapImagePath || "/placeholder.svg"}
                alt={`${kioskLocation}동 위치 지도`}
                fill
                className="object-contain p-0 m-0"
                priority
              />
            </div>

            <div className="w-full text-left space-y-4 mt-8">
              <p className="font-bold text-3xl">모텔 위치</p>
              <p className="text-gray-700 text-2xl font-bold">{locationTitle} 지도</p>
              <p className="text-gray-600 text-xl font-bold">The Beach Stay {kioskLocation} Building Map</p>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => onNavigate("standby")}
          className="h-20 text-2xl w-full border-3 border-gray-300 mt-auto font-bold"
        >
          돌아가기
        </Button>
      </div>
    </div>
  )
}

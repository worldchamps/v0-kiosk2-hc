"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Image from "next/image"
import { Phone } from "lucide-react"
import { useIdleTimer } from "@/hooks/use-idle-timer"

interface OnSiteReservationProps {
  onNavigate: (screen: string) => void
}

export default function OnSiteReservation({ onNavigate }: OnSiteReservationProps) {
  const roomTypes = [
    { name: "디럭스 더블", image: "/cozy-hotel-corner.png" },
    { name: "스탠다드 더블", image: "/sleek-city-hotel.png" },
    { name: "스탠다드 트윈", image: "/opulent-suite.png" },
    { name: "스위트 트윈", image: "/opulent-suite.png" },
  ]

  useIdleTimer({
    onIdle: () => {
      console.log("[v0] On-site reservation idle, navigating to idle screen")
      onNavigate("idle")
    },
    idleTime: 60000, // 60 seconds
    enabled: true,
  })

  return (
    <div className="flex items-start justify-start w-full h-full">
      <div className="kiosk-content-container">
        <div>
          <h1 className="kiosk-title">더 비치스테이 A동</h1>
          <div className="kiosk-highlight">현장 예약</div>
        </div>

        <div className="w-full overflow-auto py-6 mt-8">
          <div className="grid grid-cols-1 gap-8 w-full mb-10">
            {roomTypes.map((room, index) => (
              <Card key={index} className="overflow-hidden shadow-md">
                <Image
                  src={room.image || "/placeholder.svg"}
                  alt={room.name}
                  width={300}
                  height={200}
                  className="w-full h-56 object-cover"
                />
                <CardContent className="p-6">
                  <p className="font-bold text-left text-2xl">{room.name}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="w-full mb-10 shadow-md">
            <CardContent className="p-8 flex flex-col items-start justify-start space-y-6">
              <Phone className="h-16 w-16 text-gray-400" />

              <div className="text-left">
                <p className="font-bold text-2xl">예약 문의</p>
                <p className="text-3xl font-bold">010-5126-4644</p>
              </div>

              <p className="text-left text-gray-700 text-2xl font-bold">현장 예약은 C동 안내실로 오십시오.</p>
            </CardContent>
          </Card>
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

"use client"

import { useEffect } from "react"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"
import { playIdleWelcome } from "@/lib/audio-utils"

interface IdleScreenProps {
  onNavigate: (screen: string) => void
  kioskLocation: KioskLocation
  imageUrl?: string
}

export default function IdleScreen({ onNavigate, kioskLocation, imageUrl }: IdleScreenProps) {
  const locationTitle = getLocationTitle(kioskLocation)

  useEffect(() => {
    console.log("[v0] IdleScreen mounted, playing welcome audio")
    playIdleWelcome()
  }, [])

  const handleScreenTouch = () => {
    console.log("[v0] Idle screen touched, navigating to standby")
    onNavigate("standby")
  }

  return (
    <div
      className="relative flex items-center justify-center w-full h-full bg-[#fefef7] overflow-hidden cursor-pointer"
      onClick={handleScreenTouch}
    >
      {imageUrl && (
        <img
          src={imageUrl || "/placeholder.svg"}
          alt="Idle background"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Overlay content */}
      <div className="relative z-10 text-center space-y-8 p-12 bg-black bg-opacity-40 rounded-3xl">
        <h1 className="text-8xl font-bold text-white drop-shadow-lg">{locationTitle}</h1>
        <p className="text-6xl font-bold text-white drop-shadow-lg">셀프 체크인</p>
        <p className="text-4xl text-white drop-shadow-lg mt-8">화면을 터치해주세요</p>
        <div className="animate-bounce mt-12">
          <svg
            className="w-24 h-24 mx-auto text-white"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
          </svg>
        </div>
      </div>
    </div>
  )
}

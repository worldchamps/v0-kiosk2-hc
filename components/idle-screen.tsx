"use client"

import { useEffect, useRef, useState } from "react"
import { type KioskLocation, getLocationTitle } from "@/lib/location-utils"

interface IdleScreenProps {
  onNavigate: (screen: string) => void
  kioskLocation: KioskLocation
  videoUrl?: string
}

export default function IdleScreen({ onNavigate, kioskLocation, videoUrl }: IdleScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoError, setVideoError] = useState(false)
  const locationTitle = getLocationTitle(kioskLocation)

  useEffect(() => {
    // Auto-play video when component mounts
    if (videoRef.current && videoUrl && !videoError) {
      videoRef.current.play().catch((error) => {
        console.error("Video autoplay failed:", error)
        setVideoError(true)
      })
    }
  }, [videoUrl, videoError])

  const handleScreenTouch = () => {
    console.log("[v0] Idle screen touched, navigating to standby")
    onNavigate("standby")
  }

  return (
    <div
      className="relative flex items-center justify-center w-full h-full bg-[#fefef7] overflow-hidden cursor-pointer"
      onClick={handleScreenTouch}
    >
      {/* Video background */}
      {videoUrl && !videoError && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          loop
          muted
          playsInline
          autoPlay
          onError={() => {
            console.error("Video failed to load")
            setVideoError(true)
          }}
        >
          <source src={videoUrl} type="video/mp4" />
        </video>
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

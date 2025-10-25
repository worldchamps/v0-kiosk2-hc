"use client"

import { useSearchParams } from "next/navigation"
import LoadingScreen from "@/components/loading-screen"

export default function LoadingPage() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") || "/"

  return <LoadingScreen redirectTo={redirectTo} message="화면 전환 중" autoRedirectDelay={2000} />
}

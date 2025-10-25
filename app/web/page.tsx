"use client"

import { useRouter } from "next/navigation"
import WebLayout from "@/components/web-layout"

export default function WebPage() {
  const router = useRouter()

  return <WebLayout onChangeMode={() => router.push("/")} />
}

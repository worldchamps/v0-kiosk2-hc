"use client"

import { useEffect } from "react"

export default function KioskErrorRecovery() {
  useEffect(() => {
    const timer = setTimeout(() => {
      // Force kiosk mode even when the failed screen was the administrator workspace.
      const url = new URL(window.location.href)
      url.pathname = "/"
      url.search = url.searchParams.get("popup") === "true" ? "?mode=kiosk&popup=true" : "?mode=kiosk&home=true"
      url.hash = ""
      window.location.replace(url.href)
    }, 10000)
    return () => clearTimeout(timer)
  }, [])

  return <main role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fff", color: "#172b4d", font: "28px system-ui", textAlign: "center", padding: "24px" }}>
    잠시 후 처음 화면으로 돌아갑니다
  </main>
}

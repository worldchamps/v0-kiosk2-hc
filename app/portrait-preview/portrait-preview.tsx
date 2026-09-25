"use client"

import { useEffect, useState } from "react"

const WIDTH = 941
const HEIGHT = 1672

export default function PortraitPreview() {
  const [fit, setFit] = useState(1)
  const [actualSize, setActualSize] = useState(false)

  useEffect(() => {
    const resize = () => setFit(Math.min((window.innerWidth - 32) / WIDTH, (window.innerHeight - 106) / HEIGHT, 1))
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])

  const scale = actualSize ? 1 : fit

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#e8edf4", fontFamily: "Arial, sans-serif" }}>
      <header style={{ minHeight: 74, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, color: "#17294b" }}>
        <div><strong>키오스크 세로 미리보기</strong><div style={{ fontSize: 14 }}>기준 화면 941 × 1672</div></div>
        <button type="button" onClick={() => setActualSize(value => !value)} style={{ minHeight: 44, padding: "8px 16px", borderRadius: 12, color: "white", background: "#1558ae", fontWeight: 700 }}>
          {actualSize ? "전체 보기" : "100% 크기"}
        </button>
      </header>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div style={{ width: WIDTH * scale, height: HEIGHT * scale, margin: "0 auto", boxShadow: "0 12px 36px #15294d33", background: "white" }}>
          <iframe title="키오스크 941 × 1672 세로 화면" src="/" style={{ width: WIDTH, height: HEIGHT, border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }} />
        </div>
      </div>
    </main>
  )
}

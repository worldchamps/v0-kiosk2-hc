import type React from "react"
import "./globals.css"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className="light" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}

export const metadata = {
  generator: "v0.dev",
}

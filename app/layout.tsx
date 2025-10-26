import type React from "react"
import "./globals.css"
import { PaymentProvider } from "@/contexts/payment-context"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className="light" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <PaymentProvider>{children}</PaymentProvider>
      </body>
    </html>
  )
}

export const metadata = {
  generator: "v0.dev",
}

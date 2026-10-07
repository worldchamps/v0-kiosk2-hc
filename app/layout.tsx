import type React from "react"
import "./globals.css"
import { PaymentProvider } from "@/contexts/payment-context"
import { AdminProvider } from "@/contexts/admin-context"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className="light" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AdminProvider><PaymentProvider>{children}</PaymentProvider></AdminProvider>
      </body>
    </html>
  )
}

export const metadata = {
  generator: "v0.dev",
}

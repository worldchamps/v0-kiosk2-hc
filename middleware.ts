import { NextResponse, type NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (path.startsWith("/api/kiosk-assistant/")) return NextResponse.json({ error: "AI 도우미를 사용할 수 없습니다." }, { status: 404 })
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.next()
  if (request.method === "GET" && path === "/api/kiosk-config") return NextResponse.next()
  return NextResponse.json({ error: "미리보기에서는 예약과 결제를 진행할 수 없습니다." }, { status: 403 })
}

export const config = { matcher: "/api/:path*" }

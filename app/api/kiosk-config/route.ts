import { NextResponse } from "next/server"
import { getKioskScope } from "@/lib/kiosk-scope"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(getKioskScope(), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}

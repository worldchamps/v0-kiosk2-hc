import { NextResponse } from "next/server"
import { getPmsRateProperties } from "@/lib/pms-rates"
import type { PropertyId } from "@/lib/property-utils"

export const dynamic = "force-dynamic"
export const revalidate = 0

const PROPERTY_IDS: PropertyId[] = ["property1", "property2", "property3", "property4"]

export async function GET(request: Request) {
  try {
    const propertyParam = new URL(request.url).searchParams.get("property")
    const properties =
      propertyParam && PROPERTY_IDS.includes(propertyParam as PropertyId)
        ? [propertyParam as PropertyId]
        : PROPERTY_IDS
    const data = await getPmsRateProperties(properties)

    return NextResponse.json(
      {
        source: "firebase-realtime-database",
        path: "pms_status",
        properties: data,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    )
  } catch (error) {
    console.error("[PMS rates] Failed to read pms_status:", error)
    return NextResponse.json(
      { error: "Firebase PMS 요금을 불러오지 못했습니다." },
      { status: 500 },
    )
  }
}

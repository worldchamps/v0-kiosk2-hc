import { NextResponse } from "next/server"
import { getAvailableRooms } from "@/lib/firebase-beach-rooms"
import { findPmsRateRoom, getPmsRateProperties } from "@/lib/pms-rates"
import { getPropertyFromRoomNumber, type PropertyId } from "@/lib/property-utils"
import { getKioskScope, isRoomInBuilding } from "@/lib/kiosk-scope"
import {
  defaultKioskSalesPolicy,
  findKioskRoomSalesConfig,
  getKioskSalesConfig,
  hasPositiveRate,
  isKioskSalesWindowOpen,
} from "@/lib/kiosk-sales-config"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const scope = getKioskScope()
    const location = scope.building || searchParams.get("location")?.toUpperCase()

    console.log("[v0] Filtering by location:", location || "ALL")

    const availableRooms = (await getAvailableRooms(location || undefined))
      .filter((room) => isRoomInBuilding(room.matchingRoomNumber, scope.building))

    console.log("[v0] Available rooms from Firebase:", availableRooms.length)

    if (availableRooms.length === 0) {
      return NextResponse.json({
        availableRooms: [],
        roomsByType: {},
        total: 0,
        location: location || "ALL",
        message: "No available rooms found",
        source: "firebase",
      })
    }

    const properties = [
      ...new Set(
        availableRooms
          .map((room) => getPropertyFromRoomNumber(room.matchingRoomNumber))
          .filter((property): property is PropertyId => Boolean(property)),
      ),
    ]
    const [pmsProperties, configs] = await Promise.all([
      properties.length > 0 ? getPmsRateProperties(properties) : [],
      Promise.all(properties.map(async (property) => [property, await getKioskSalesConfig(property)] as const)),
    ])
    const configByProperty = new Map(configs)

    const mappedRooms = availableRooms.map((room) => {
      const property = getPropertyFromRoomNumber(room.matchingRoomNumber)
      const pmsRoom = findPmsRateRoom(pmsProperties, room.matchingRoomNumber, room.roomNumber)
      const pmsProperty = pmsProperties.find((item) => item.property === pmsRoom?.property)
      const config = property ? configByProperty.get(property) ?? null : null
      const configuredRoom = findKioskRoomSalesConfig(config, room.matchingRoomNumber)
      const policy = property && config ? config.policy : property ? defaultKioskSalesPolicy(property) : null
      const rates = configuredRoom?.rates ?? pmsRoom?.rates ?? null
      const roomEnabled = config ? configuredRoom?.enabled === true : true

      return {
        building: room.category,
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        password: room.password,
        status: room.status,
        floor: room.floor,
        roomCode: room.matchingRoomNumber,
        rates,
        stayEnabled: {
          overnight: Boolean(
            roomEnabled &&
              (configuredRoom?.overnightEnabled ?? true) &&
              policy &&
              isKioskSalesWindowOpen(policy, "overnight"),
          ),
          shortStay: Boolean(
            roomEnabled &&
              (configuredRoom?.shortStayEnabled ?? true) &&
              policy &&
              isKioskSalesWindowOpen(policy, "shortStay"),
          ),
        },
        ratesSource: configuredRoom ? "kiosk_sales_config" : pmsRoom ? "pms_status" : null,
        ratesUpdatedAt: config?.updatedAt ?? pmsProperty?.timestamp ?? null,
      }
    }).filter((room) =>
      (room.stayEnabled.overnight && hasPositiveRate(room.rates?.overnight)) ||
      (room.stayEnabled.shortStay && hasPositiveRate(room.rates?.shortStay)),
    )

    console.log("[v0] Sample room data from Firebase:")
    if (mappedRooms.length > 0) {
      console.log("[v0] First room:", {
        roomNumber: mappedRooms[0].roomNumber,
        matchingRoomNumber: availableRooms[0].matchingRoomNumber,
        roomCode: mappedRooms[0].roomCode,
      })
    }

    // Group by room type
    const roomsByType = mappedRooms.reduce(
      (acc, room) => {
        if (!acc[room.roomType]) {
          acc[room.roomType] = []
        }
        acc[room.roomType].push(room)
        return acc
      },
      {} as Record<string, typeof mappedRooms>,
    )

    return NextResponse.json({
      availableRooms: mappedRooms,
      roomsByType,
      total: mappedRooms.length,
      location: location || "ALL",
      source: "firebase",
      ratesSource: "kiosk_sales_config",
    })
  } catch (error) {
    console.error("Error fetching available rooms:", error)
    return NextResponse.json(
      { error: "Failed to fetch available rooms", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

import { getDB } from "@/lib/firebase-admin"
import { getPropertyFromRoomNumber, type PropertyId } from "@/lib/property-utils"

export type PmsStayType = "overnight" | "shortStay"
export type PmsPaymentMethod = "CARD" | "CASH"

export interface PmsPaymentRates {
  card: number
  cash: number
}

export interface PmsRoomRates {
  overnight: PmsPaymentRates
  shortStay: PmsPaymentRates
}

export interface PmsRateRoom {
  property: PropertyId
  room: string
  roomType: string
  status: string
  rates: PmsRoomRates
}

interface RawPmsRoom {
  room?: unknown
  roomType?: unknown
  status?: unknown
  sukbakCard?: unknown
  sukbakCash?: unknown
  daesilCard?: unknown
  daesilCash?: unknown
}

interface RawPmsStatus {
  rooms?: Record<string, RawPmsRoom> | RawPmsRoom[]
  timestamp?: unknown
}

export interface PmsRateProperty {
  property: PropertyId
  timestamp: string | null
  rooms: PmsRateRoom[]
}

const ALL_PROPERTIES: PropertyId[] = ["property1", "property2", "property3", "property4"]

export function parsePmsAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
  }

  if (typeof value !== "string") return 0

  const normalized = value.replace(/[^\d.-]/g, "")
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0
}

function normalizeRoomDigits(value: string) {
  const digits = value.match(/\d+/g)?.join("") ?? ""
  return digits ? String(Number(digits)) : ""
}

function getBuildingLetter(value: string) {
  return value.trim().toUpperCase().match(/^([A-D])(?:\s*동|[\s-]*\d)/)?.[1] ?? ""
}

function rawRooms(status: RawPmsStatus | null | undefined): RawPmsRoom[] {
  if (!status?.rooms) return []
  const rooms = Array.isArray(status.rooms) ? status.rooms : Object.values(status.rooms)
  return rooms.filter((room) => room && typeof room === "object" && room.room != null)
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const compact = value.trim()
    const match = compact.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
    }
    return compact
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  return null
}

function normalizePmsRoom(property: PropertyId, room: RawPmsRoom): PmsRateRoom {
  return {
    property,
    room: String(room.room ?? "").trim(),
    roomType: String(room.roomType ?? "").trim(),
    status: String(room.status ?? "").trim(),
    rates: {
      overnight: {
        card: parsePmsAmount(room.sukbakCard),
        cash: parsePmsAmount(room.sukbakCash),
      },
      shortStay: {
        card: parsePmsAmount(room.daesilCard),
        cash: parsePmsAmount(room.daesilCash),
      },
    },
  }
}

export async function getPmsRateProperties(properties: PropertyId[] = ALL_PROPERTIES): Promise<PmsRateProperty[]> {
  const database = getDB()
  const uniqueProperties = [...new Set(properties)]

  return Promise.all(
    uniqueProperties.map(async (property) => {
      const snapshot = await database.ref(`pms_status/${property}`).once("value")
      const status = (snapshot.val() ?? {}) as RawPmsStatus

      return {
        property,
        timestamp: normalizeTimestamp(status.timestamp),
        rooms: rawRooms(status).map((room) => normalizePmsRoom(property, room)),
      }
    }),
  )
}

export function findPmsRateRoom(
  properties: PmsRateProperty[],
  roomCode: string,
  roomNumber = "",
): PmsRateRoom | null {
  const property = getPropertyFromRoomNumber(roomCode)
  if (!property) return null

  const targetDigits = normalizeRoomDigits(roomNumber || roomCode)
  const targetBuilding = getBuildingLetter(roomCode)
  const candidates = properties
    .find((item) => item.property === property)
    ?.rooms.filter((room) => normalizeRoomDigits(room.room) === targetDigits)

  if (!candidates?.length) return null
  if (!targetBuilding) return candidates.length === 1 ? candidates[0] : null

  const buildingOf = (room: PmsRateRoom) => getBuildingLetter(room.room) || getBuildingLetter(room.roomType)
  const matching = candidates.filter((room) => buildingOf(room) === targetBuilding)
  if (matching.length) return matching.length === 1 ? matching[0] : null
  // Legacy numeric-only PMS rows are usable only when their building is unambiguous.
  const unspecified = candidates.filter((room) => !buildingOf(room))
  return candidates.length === 1 && unspecified.length === 1 ? unspecified[0] : null
}

export async function getPmsRateRoom(roomCode: string, roomNumber = "") {
  const property = getPropertyFromRoomNumber(roomCode)
  if (!property) return null
  const properties = await getPmsRateProperties([property])
  return findPmsRateRoom(properties, roomCode, roomNumber)
}

export async function getPmsRateAmount(params: {
  roomCode: string
  roomNumber?: string
  stayType: PmsStayType
  paymentMethod: PmsPaymentMethod
}) {
  const room = await getPmsRateRoom(params.roomCode, params.roomNumber)
  if (!room) return null

  const rates = room.rates[params.stayType]
  const amount = params.paymentMethod === "CARD" ? rates.card : rates.cash
  return amount > 0 ? amount : null
}

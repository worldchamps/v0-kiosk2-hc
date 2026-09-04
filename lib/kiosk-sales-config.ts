import type { PropertyId } from "@/lib/property-utils"
import type { PmsPaymentRates, PmsRoomRates, PmsStayType } from "@/lib/pms-rates"

export interface KioskRoomSalesConfig {
  roomCode: string
  roomNumber: string
  roomType: string
  enabled: boolean
  overnightEnabled: boolean
  shortStayEnabled: boolean
  rates: PmsRoomRates
}

export interface KioskSalesPolicy {
  overnightEnabled: boolean
  overnightTimeRestricted: boolean
  overnightSaleStartTime: string
  overnightSaleEndTime: string
  overnightCheckoutTime: string
  shortStayEnabled: boolean
  shortStayTimeRestricted: boolean
  shortStaySaleStartTime: string
  shortStaySaleEndTime: string
  shortStayDurationMinutes: number
}

export interface KioskPropertySalesConfig {
  property: PropertyId
  updatedAt: string | null
  policy: KioskSalesPolicy
  rooms: KioskRoomSalesConfig[]
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function defaultKioskSalesPolicy(property: PropertyId): KioskSalesPolicy {
  return {
    overnightEnabled: true,
    overnightTimeRestricted: false,
    overnightSaleStartTime: "00:00",
    overnightSaleEndTime: "23:59",
    overnightCheckoutTime: "11:00",
    shortStayEnabled: true,
    shortStayTimeRestricted: property === "property1" || property === "property3",
    shortStaySaleStartTime: "00:00",
    shortStaySaleEndTime: "21:00",
    shortStayDurationMinutes: 180,
  }
}

function normalizeTime(value: unknown, fallback: string) {
  return typeof value === "string" && TIME_PATTERN.test(value) ? value : fallback
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function normalizeAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
  if (typeof value !== "string") return 0
  const amount = Number(value.replace(/[^\d.-]/g, ""))
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0
}

export function normalizeKioskSalesPolicy(property: PropertyId, value: any): KioskSalesPolicy {
  const fallback = defaultKioskSalesPolicy(property)
  const duration = Number(value?.shortStayDurationMinutes)
  return {
    overnightEnabled: normalizeBoolean(value?.overnightEnabled, fallback.overnightEnabled),
    overnightTimeRestricted: normalizeBoolean(value?.overnightTimeRestricted, fallback.overnightTimeRestricted),
    overnightSaleStartTime: normalizeTime(value?.overnightSaleStartTime, fallback.overnightSaleStartTime),
    overnightSaleEndTime: normalizeTime(value?.overnightSaleEndTime, fallback.overnightSaleEndTime),
    overnightCheckoutTime: normalizeTime(value?.overnightCheckoutTime, fallback.overnightCheckoutTime),
    shortStayEnabled: normalizeBoolean(value?.shortStayEnabled, fallback.shortStayEnabled),
    shortStayTimeRestricted: normalizeBoolean(value?.shortStayTimeRestricted, fallback.shortStayTimeRestricted),
    shortStaySaleStartTime: normalizeTime(value?.shortStaySaleStartTime, fallback.shortStaySaleStartTime),
    shortStaySaleEndTime: normalizeTime(value?.shortStaySaleEndTime, fallback.shortStaySaleEndTime),
    shortStayDurationMinutes:
      Number.isFinite(duration) && duration >= 30 && duration <= 1440 ? Math.round(duration) : fallback.shortStayDurationMinutes,
  }
}

function normalizeRates(value: any): PmsRoomRates {
  return {
    overnight: { card: normalizeAmount(value?.overnight?.card), cash: normalizeAmount(value?.overnight?.cash) },
    shortStay: { card: normalizeAmount(value?.shortStay?.card), cash: normalizeAmount(value?.shortStay?.cash) },
  }
}

export async function getKioskSalesConfig(property: PropertyId): Promise<KioskPropertySalesConfig | null> {
  const { getDB } = await import("@/lib/firebase-admin")
  const snapshot = await getDB().ref(`kiosk_sales_config/${property}`).once("value")
  const value = snapshot.val()
  if (!value) return null

  const rawRooms = Array.isArray(value.rooms) ? value.rooms : Object.values(value.rooms || {})
  const rooms = rawRooms
    .map((room: any): KioskRoomSalesConfig => ({
      roomCode: String(room?.roomCode || "").trim(),
      roomNumber: String(room?.roomNumber || room?.roomCode || "").trim(),
      roomType: String(room?.roomType || "").trim(),
      enabled: normalizeBoolean(room?.enabled, true),
      overnightEnabled: normalizeBoolean(room?.overnightEnabled, true),
      shortStayEnabled: normalizeBoolean(room?.shortStayEnabled, true),
      rates: normalizeRates(room?.rates),
    }))
    .filter((room: KioskRoomSalesConfig) => room.roomCode)

  return {
    property,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    policy: normalizeKioskSalesPolicy(property, value.policy),
    rooms,
  }
}

export function findKioskRoomSalesConfig(config: KioskPropertySalesConfig | null, roomCode: string) {
  const normalized = roomCode.trim().toUpperCase().replace(/\s/g, "")
  return config?.rooms.find((room) => room.roomCode.toUpperCase().replace(/\s/g, "") === normalized) || null
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

export function isKioskSalesWindowOpen(policy: KioskSalesPolicy, stayType: PmsStayType, now = new Date()) {
  const enabled = stayType === "overnight" ? policy.overnightEnabled : policy.shortStayEnabled
  const restricted = stayType === "overnight" ? policy.overnightTimeRestricted : policy.shortStayTimeRestricted
  if (!enabled) return false
  if (!restricted) return true

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const current = minutes(`${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`)
  const start = minutes(stayType === "overnight" ? policy.overnightSaleStartTime : policy.shortStaySaleStartTime)
  const end = minutes(stayType === "overnight" ? policy.overnightSaleEndTime : policy.shortStaySaleEndTime)

  if (start === end) return true
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function hasPositiveRate(rates: PmsPaymentRates | undefined) {
  return Boolean(rates && (rates.card > 0 || rates.cash > 0))
}

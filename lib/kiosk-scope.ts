import type { PropertyId } from "./property-utils"

export type KioskBuilding = "A" | "B"
export interface KioskScope {
  property: PropertyId
  building: KioskBuilding | null
}

// Read at request time: one installer is shared by both PCs. Never trust a
// URL, localStorage, or a request body's property/building as device identity.
export function getKioskScope(env: NodeJS.ProcessEnv = process.env): KioskScope {
  const property = env.KIOSK_PROPERTY_ID || env.NEXT_PUBLIC_KIOSK_PROPERTY_ID || "property3"
  if (!/^property[1-4]$/.test(property)) throw new Error("키오스크 숙소 설정을 확인해 주세요.")
  if (property !== "property3") return { property: property as PropertyId, building: null }
  const building = env.KIOSK_BUILDING
  if (building !== "A" && building !== "B") {
    throw new Error("property3 키오스크 PC 설정에 KIOSK_BUILDING=A 또는 B가 필요합니다. 관리자에게 문의해 주세요.")
  }
  return { property, building }
}

export function isRoomInBuilding(roomNumber: unknown, building: KioskBuilding | null): boolean {
  if (!building) return true
  if (typeof roomNumber !== "string") return false
  return roomNumber.trim().toUpperCase().match(/^([AB])[\s-]?\d{3}$/)?.[1] === building
}

export function buildingRestrictionMessage(building: KioskBuilding): string {
  return `이 키오스크는 ${building}동 전용입니다. 다른 동 예약은 해당 동 키오스크를 이용해 주세요. 객실이 미배정된 예약은 관리자에게 문의해 주세요.`
}

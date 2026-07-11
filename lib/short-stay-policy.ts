import type { PropertyId } from "@/lib/property-utils"

export const SHORT_STAY_CUTOFF_HOUR = 21

export function isShortStayRestrictedProperty(propertyId: PropertyId | null) {
  return propertyId === "property1" || propertyId === "property3"
}

export function isShortStayAvailable(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  )

  return hour < SHORT_STAY_CUTOFF_HOUR
}

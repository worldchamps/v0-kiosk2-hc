// Property 기반 키오스크 제약 유틸리티

export type PropertyId = "property1" | "property2" | "property3" | "property4"

/**
 * 객실 번호로부터 Property 감지
 */
export function getPropertyFromRoomNumber(roomNumber: string): PropertyId {
  const upperRoom = roomNumber.toUpperCase().trim()

  // Property 1: C### or D### pattern
  if (upperRoom.match(/^[CD]\d{3}$/)) {
    return "property1"
  }

  // Property 2: Kariv ### pattern
  if (upperRoom.match(/^KARIV\s*\d+$/i)) {
    return "property2"
  }

  // Property 3: A### 또는 B### 형식
  if (upperRoom.match(/^[AB]\d{3}$/)) {
    return "property3"
  }

  // Property 4: Camp ### 형식
  if (upperRoom.match(/^CAMP\s*\d+$/i)) {
    return "property4"
  }

  // 기본값: property3
  return "property3"
}

/**
 * Place 필드로부터 Property 감지
 */
export function getPropertyFromPlace(place: string): PropertyId {
  const upperPlace = place.toUpperCase().trim()

  if (upperPlace.includes("C") || upperPlace.includes("D")) {
    return "property1"
  }

  if (upperPlace.includes("KARIV")) {
    return "property2"
  }

  if (upperPlace.includes("A") || upperPlace.includes("B")) {
    return "property3"
  }

  if (upperPlace.includes("CAMP")) {
    return "property4"
  }

  return "property3"
}

/**
 * Property ID를 사람이 읽을 수 있는 이름으로 변환
 */
export function getPropertyDisplayName(propertyId: PropertyId): string {
  const names: Record<PropertyId, string> = {
    property1: "더 비치스테이 C/D동",
    property2: "Kariv Hotel",
    property3: "더 비치스테이 A/B동",
    property4: "더 캠프스테이",
  }
  return names[propertyId]
}

/**
 * 키오스크 Property ID 가져오기 (환경변수)
 */
export function getKioskPropertyId(): PropertyId {
  if (typeof window === "undefined") {
    // 서버 사이드
    return (process.env.KIOSK_PROPERTY_ID as PropertyId) || "property3"
  }

  // 클라이언트 사이드 - NEXT_PUBLIC_ 접두사 필요
  return (process.env.NEXT_PUBLIC_KIOSK_PROPERTY_ID as PropertyId) || "property3"
}

/**
 * 키오스크 Property ID 저장
 * @deprecated 환경변수를 사용하므로 더 이상 필요하지 않음
 */
export function setKioskPropertyId(propertyId: PropertyId): void {
  console.warn("[v0] setKioskPropertyId is deprecated. Use KIOSK_PROPERTY_ID environment variable instead.")
}

/**
 * 예약이 현재 키오스크에서 체크인 가능한지 검증
 */
export function canCheckInAtKiosk(
  reservationProperty: PropertyId,
  kioskProperty: PropertyId,
  adminOverride = false,
): { allowed: boolean; reason?: string } {
  // 관리자 오버라이드가 활성화된 경우 허용
  if (adminOverride) {
    return { allowed: true }
  }

  // Property가 일치하는 경우 허용
  if (reservationProperty === kioskProperty) {
    return { allowed: true }
  }

  // Property가 일치하지 않는 경우 거부
  const kioskName = getPropertyDisplayName(kioskProperty)
  const correctName = getPropertyDisplayName(reservationProperty)

  return {
    allowed: false,
    reason: `이 예약은 ${correctName} 키오스크에서만 체크인 가능합니다.\n현재 키오스크: ${kioskName}`,
  }
}

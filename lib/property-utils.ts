// Property 기반 키오스크 제약 유틸리티

export type PropertyId = "property1" | "property2" | "property3" | "property4"

/**
 * 객실 번호로부터 Property 감지
 */
export function getPropertyFromRoomNumber(roomNumber: string): PropertyId | null {
  if (!roomNumber) return null

  const upperRoom = roomNumber.toUpperCase().trim()

  // Property 1: C### or D### pattern (C101, C 101, C-101, etc.)
  if (upperRoom.match(/^[CD][\s-]?\d{3}$/)) {
    return "property1"
  }

  // Property 2: Kariv ### pattern (Kariv301, Kariv 301, etc.)
  if (upperRoom.match(/^KARIV[\s-]?\d+$/i)) {
    return "property2"
  }

  // Property 3: A### or B### pattern (A101, B202, etc.)
  if (upperRoom.match(/^[AB][\s-]?\d{3}$/)) {
    return "property3"
  }

  // Property 4: Camp ### pattern (Camp101, Camp 101, etc.)
  if (upperRoom.match(/^CAMP[\s-]?\d+$/i)) {
    return "property4"
  }

  return null
}

/**
 * Place 필드로부터 Property 감지
 */
export function getPropertyFromPlace(place: string): PropertyId | null {
  if (!place) return null

  const upperPlace = place.toUpperCase().trim()

  // Property 2: Kariv Hotel
  if (upperPlace.includes("KARIV")) {
    return "property2"
  }

  // Property 4: 더 캠프스테이 / Camp
  if (upperPlace.includes("CAMP") || upperPlace.includes("캠프")) {
    return "property4"
  }

  // Property 1 & 3: 더 비치스테이 (need to check room number to distinguish)
  // Return null so we can check room number instead
  if (upperPlace.includes("비치") || upperPlace.includes("BEACH")) {
    return null // Will be determined by room number
  }

  return null
}

/**
 * 예약 정보로부터 Property 감지
 */
export function getPropertyFromReservation(reservation: {
  place?: string
  roomNumber?: string
}): PropertyId | null {
  console.log("[v0] 🔍 Property 감지 시작:", {
    place: reservation.place,
    roomNumber: reservation.roomNumber,
  })

  // Place 필드 우선 확인
  if (reservation.place) {
    const propertyFromPlace = getPropertyFromPlace(reservation.place)
    console.log("[v0] Place로 감지:", propertyFromPlace)
    // Place에서 명확한 property를 감지한 경우에만 반환 (null이 아닌 경우)
    if (propertyFromPlace) {
      return propertyFromPlace
    }
    // Place에서 null이 반환되면 객실 번호로 계속 진행
  }

  // 2. 객실 번호로 확인
  if (reservation.roomNumber) {
    const propertyFromRoom = getPropertyFromRoomNumber(reservation.roomNumber)
    console.log("[v0] 객실번호로 감지:", propertyFromRoom)
    if (propertyFromRoom) {
      return propertyFromRoom
    }
  }

  console.warn("[v0] ⚠️ Property 감지 실패 - place와 roomNumber 모두 매칭 안됨")
  return null
}

/**
 * Property ID를 사람이 읽을 수 있는 이름으로 변환
 */
export function getPropertyDisplayName(propertyId: PropertyId): string {
  const names: Record<PropertyId, string> = {
    property1: "더비치스테이 C,D동",
    property2: "카리브",
    property3: "더비치스테이 A,B동",
    property4: "더캠프스테이",
  }
  return names[propertyId]
}

/**
 * 키오스크 Property ID 가져오기 (환경변수)
 */
export function getKioskPropertyId(): PropertyId {
  let propertyId: PropertyId

  if (typeof window === "undefined") {
    // 서버 사이드
    propertyId = (process.env.KIOSK_PROPERTY_ID as PropertyId) || "property3"
    console.log("[v0] 🖥️ Server-side environment check:")
    console.log("[v0]   - KIOSK_PROPERTY_ID:", process.env.KIOSK_PROPERTY_ID)
    console.log("[v0]   - Resolved to:", propertyId)
  } else {
    // 클라이언트 사이드 - NEXT_PUBLIC_ 접두사 필요
    const envValue = process.env.NEXT_PUBLIC_KIOSK_PROPERTY_ID
    propertyId = (envValue as PropertyId) || "property3"

    console.log("[v0] 🌐 Client-side environment check:")
    console.log("[v0]   - NEXT_PUBLIC_KIOSK_PROPERTY_ID:", envValue)
    console.log("[v0]   - Raw value:", envValue)
    console.log("[v0]   - Type:", typeof envValue)
    console.log("[v0]   - Resolved to:", propertyId)
    console.log(
      "[v0]   - All NEXT_PUBLIC_ vars:",
      Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_")),
    )
  }

  if (propertyId === "property3") {
    console.warn("[v0] ⚠️ Using default property3!")
    console.warn("[v0] 💡 Check if NEXT_PUBLIC_KIOSK_PROPERTY_ID is set in .env.local")
    console.warn("[v0] 💡 You may need to restart the Next.js dev server")
  }

  return propertyId
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

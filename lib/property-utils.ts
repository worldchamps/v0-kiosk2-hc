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
  if (upperPlace.includes("KARIV") || upperPlace.includes("카리브")) {
    return "property2"
  }

  // Property 4: 더 캠프스테이 / Camp
  if (upperPlace.includes("CAMP") || upperPlace.includes("캠프")) {
    return "property4"
  }

  if (upperPlace.includes("비치") || upperPlace.includes("BEACH")) {
    // C동 또는 D동이 포함되어 있으면 Property 1
    if (
      upperPlace.includes("C동") ||
      upperPlace.includes("D동") ||
      upperPlace.includes("C,D") ||
      upperPlace.includes("CD")
    ) {
      return "property1"
    }

    // A동 또는 B동이 포함되어 있으면 Property 3
    if (
      upperPlace.includes("A동") ||
      upperPlace.includes("B동") ||
      upperPlace.includes("A,B") ||
      upperPlace.includes("AB")
    ) {
      return "property3"
    }

    // 동 정보가 없으면 null 반환 (객실 번호로 판단)
    return null
  }

  return null
}

/**
 * 예약 정보로부터 Property 감지
 * 객실 번호를 우선으로 확인하고, 실패하면 Place 필드로 확인
 */
export function getPropertyFromReservation(reservation: {
  place?: string
  roomNumber?: string
}): PropertyId | null {
  console.log("[v0] 🔍 Property 감지 시작:", {
    place: reservation.place,
    roomNumber: reservation.roomNumber,
  })

  if (reservation.roomNumber) {
    const propertyFromRoom = getPropertyFromRoomNumber(reservation.roomNumber)
    console.log("[v0] 객실번호로 감지:", propertyFromRoom)
    if (propertyFromRoom) {
      console.log("[v0] ✅ 객실번호로 Property 확정:", propertyFromRoom)
      return propertyFromRoom
    }
  }

  if (reservation.place) {
    const propertyFromPlace = getPropertyFromPlace(reservation.place)
    console.log("[v0] Place로 감지:", propertyFromPlace)
    if (propertyFromPlace) {
      console.log("[v0] ✅ Place로 Property 확정:", propertyFromPlace)
      return propertyFromPlace
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
 * 키오스크 Property ID 가져오기
 * Electron 환경에서는 IPC를 통해, 웹 환경에서는 환경변수를 통해 가져옴
 */
export async function getKioskPropertyId(): Promise<PropertyId> {
  if (typeof window !== "undefined" && (window as any).electronAPI) {
    try {
      const propertyId = await (window as any).electronAPI.getPropertyId()
      console.log("[v0] 🖥️ Electron environment - Property ID:", propertyId)
      return propertyId as PropertyId
    } catch (error) {
      console.error("[v0] ❌ Failed to get property ID from Electron:", error)
    }
  }

  let propertyId: PropertyId

  if (typeof window === "undefined") {
    // 서버 사이드
    propertyId = (process.env.KIOSK_PROPERTY_ID as PropertyId) || "property3"
    console.log("[v0] 🖥️ Server-side environment - Property ID:", propertyId)
  } else {
    // 클라이언트 사이드 - NEXT_PUBLIC_ 접두사 필요
    const envValue = process.env.NEXT_PUBLIC_KIOSK_PROPERTY_ID
    propertyId = (envValue as PropertyId) || "property3"
    console.log("[v0] 🌐 Client-side environment - Property ID:", propertyId)
  }

  if (propertyId === "property3") {
    console.warn("[v0] ⚠️ Using default property3!")
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

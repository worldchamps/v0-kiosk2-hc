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
  if (reservation.roomNumber) {
    const propertyFromRoom = getPropertyFromRoomNumber(reservation.roomNumber)
    if (propertyFromRoom) {
      return propertyFromRoom
    }
  }

  if (reservation.place) {
    const propertyFromPlace = getPropertyFromPlace(reservation.place)
    if (propertyFromPlace) {
      return propertyFromPlace
    }
  }

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
 * 서브도메인으로부터 Property 감지
 * 예: property3.example.com → property3
 *     a3.example.com → property3
 *     b3.example.com → property3
 *     camp.example.com → property4
 */
export function getPropertyFromSubdomain(hostname?: string): PropertyId | null {
  if (typeof window === "undefined" && !hostname) {
    return null
  }

  const host = hostname || (typeof window !== "undefined" ? window.location.hostname : "")
  if (!host) return null

  const subdomain = host.split(".")[0].toLowerCase()

  // Property 매핑
  const subdomainMap: Record<string, PropertyId> = {
    // Property 1
    property1: "property1",
    p1: "property1",
    c: "property1",
    d: "property1",
    cd: "property1",

    // Property 2
    property2: "property2",
    p2: "property2",
    kariv: "property2",

    // Property 3
    property3: "property3",
    p3: "property3",
    a: "property3",
    b: "property3",
    ab: "property3",
    a3: "property3",
    b3: "property3",

    // Property 4
    property4: "property4",
    p4: "property4",
    camp: "property4",
  }

  return subdomainMap[subdomain] || null
}

/**
 * 키오스크 Property ID 가져오기 (동기 버전)
 * 우선순위:
 * 1. 서브도메인 감지
 * 2. NEXT_PUBLIC_ 환경변수
 * 3. 기본값 (property3)
 */
export function getKioskPropertyId(): PropertyId {
  if (typeof window !== "undefined") {
    // 클라이언트 사이드에서 서브도메인 체크
    const propertyFromSubdomain = getPropertyFromSubdomain()
    if (propertyFromSubdomain) {
      // 감지된 Property를 캐시
      if (!(window as any).__KIOSK_PROPERTY_ID__) {
        ;(window as any).__KIOSK_PROPERTY_ID__ = propertyFromSubdomain
        console.log(`[v0] Property detected from subdomain: ${propertyFromSubdomain}`)
      }
      return propertyFromSubdomain
    }

    // 이미 캐시된 Property가 있으면 사용
    if ((window as any).__KIOSK_PROPERTY_ID__) {
      return (window as any).__KIOSK_PROPERTY_ID__ as PropertyId
    }
  }

  const nextPublicPropertyId = process.env.NEXT_PUBLIC_KIOSK_PROPERTY_ID
  const regularPropertyId = process.env.KIOSK_PROPERTY_ID

  let propertyId: PropertyId

  if (typeof window === "undefined") {
    // 서버 사이드 - 둘 다 사용 가능
    propertyId = (nextPublicPropertyId || regularPropertyId || "property3") as PropertyId
  } else {
    // 클라이언트 사이드 - NEXT_PUBLIC_ 만 사용 가능
    propertyId = (nextPublicPropertyId || "property3") as PropertyId
  }

  if (propertyId === "property3" && !nextPublicPropertyId && !regularPropertyId) {
    console.warn("[v0] Using default property3 - No subdomain or NEXT_PUBLIC_KIOSK_PROPERTY_ID set")
  }

  return propertyId
}

/**
 * Property가 Electron을 사용하는지 확인
 * Property1, 2는 오버레이 모드로 Electron 필요
 * Property3, 4는 웹 브라우저에서 실행
 */
export function propertyUsesElectron(propertyId: PropertyId): boolean {
  return propertyId === "property1" || propertyId === "property2"
}

/**
 * Property가 프린터를 사용하는지 확인
 * Property1, 2는 프린터 사용 안함
 * Property3, 4는 Web Serial Port로 프린터 사용
 */
export function propertyUsesPrinter(propertyId: PropertyId): boolean {
  return propertyId === "property3" || propertyId === "property4"
}

/**
 * Property가 Web Serial Port를 사용하는지 확인
 * Property3, 4만 Web Serial Port 사용
 */
export function propertyUsesWebSerial(propertyId: PropertyId): boolean {
  return propertyId === "property3" || propertyId === "property4"
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

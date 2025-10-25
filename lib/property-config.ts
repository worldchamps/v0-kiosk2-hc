/**
 * Property 구분 및 설정 관리
 * Property 3, 4는 Web Serial API 사용
 * Property 1, 2는 Electron 사용
 */

export type PropertyId = "1" | "2" | "3" | "4"

export interface PropertyConfig {
  id: PropertyId
  name: string
  useWebSerial: boolean // true면 Web Serial API, false면 Electron
  firebaseConfig?: {
    projectId: string
    databaseURL: string
  }
  printerConfig: {
    baudRate: number
    model: string
  }
}

const BUILDING_TO_PROPERTY: Record<string, PropertyId> = {
  CAMP: "4", // /kiosk/CAMP → Property 4
  B: "3", // /kiosk/B → Property 3
  A: "3", // /kiosk/A → Property 3
  D: "3", // /kiosk/D → Property 3 (기본값)
  KARIV: "3", // /kiosk/KARIV → Property 3 (기본값)
}

/**
 * 현재 Property ID 감지
 * 1. 환경 변수 우선 (배포 시)
 * 2. 경로 기반 건물 코드 감지 (/kiosk/{buildingCode})
 * 3. 서브도메인 감지 (property3.domain.com)
 * 4. 기본값: '3'
 */
export function getPropertyId(): PropertyId {
  // 환경 변수 확인 (가장 우선)
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PROPERTY_ID) {
    return process.env.NEXT_PUBLIC_PROPERTY_ID as PropertyId
  }

  // 브라우저에서만 실행
  if (typeof window === "undefined") {
    return "3" // SSR 기본값
  }

  const hostname = window.location.hostname
  const pathname = window.location.pathname

  const kioskMatch = pathname.match(/\/kiosk\/([A-Z]+)/i)
  if (kioskMatch) {
    const buildingCode = kioskMatch[1].toUpperCase()
    const propertyId = BUILDING_TO_PROPERTY[buildingCode]
    if (propertyId) {
      console.log(`[v0] Detected building code: ${buildingCode} → Property ${propertyId}`)
      return propertyId
    }
  }

  // 서브도메인 감지
  if (hostname.includes("property1")) return "1"
  if (hostname.includes("property2")) return "2"
  if (hostname.includes("property3")) return "3"
  if (hostname.includes("property4")) return "4"

  // 경로 감지 (레거시)
  if (pathname.startsWith("/property1")) return "1"
  if (pathname.startsWith("/property2")) return "2"
  if (pathname.startsWith("/property3")) return "3"
  if (pathname.startsWith("/property4")) return "4"

  // 기본값
  return "3"
}

/**
 * Property별 설정
 */
const PROPERTY_CONFIGS: Record<PropertyId, PropertyConfig> = {
  "1": {
    id: "1",
    name: "Property 1",
    useWebSerial: false, // Electron
    printerConfig: {
      baudRate: 9600,
      model: "BK3-3",
    },
  },
  "2": {
    id: "2",
    name: "Property 2",
    useWebSerial: false, // Electron
    printerConfig: {
      baudRate: 9600,
      model: "BK3-3",
    },
  },
  "3": {
    id: "3",
    name: "Property 3",
    useWebSerial: true, // Web Serial API
    firebaseConfig: {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "",
    },
    printerConfig: {
      baudRate: 115200,
      model: "STANDARD",
    },
  },
  "4": {
    id: "4",
    name: "Property 4",
    useWebSerial: true, // Web Serial API
    firebaseConfig: {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "",
    },
    printerConfig: {
      baudRate: 115200,
      model: "STANDARD",
    },
  },
}

/**
 * 현재 Property 설정 가져오기
 */
export function getPropertyConfig(): PropertyConfig {
  const propertyId = getPropertyId()
  return PROPERTY_CONFIGS[propertyId]
}

/**
 * Web Serial API 사용 여부 확인
 */
export function useWebSerial(): boolean {
  return getPropertyConfig().useWebSerial
}

/**
 * 올바른 프린터 유틸리티 import
 */
export async function getPrinterUtils() {
  const config = getPropertyConfig()

  if (config.useWebSerial) {
    // Property 3, 4: Web Serial API
    return await import("./printer-utils-webserial")
  } else {
    // Property 1, 2: Electron
    return await import("./printer-utils")
  }
}

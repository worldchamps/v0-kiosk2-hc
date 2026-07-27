// 키오스크 위치 타입 정의
import { getKioskPropertyId } from "@/lib/property-utils"

export type KioskLocation = "A" | "B" | "C" | "CAMP" | "D" | "KARIV"

// 로컬 스토리지에 키오스크 위치 저장
export function saveKioskLocation(location: KioskLocation): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("kioskLocation", location)
  }
}

// 로컬 스토리지에서 키오스크 위치 불러오기
export function getKioskLocation(): KioskLocation {
  const propertyId = getKioskPropertyId()

  // Property 4 is exclusively CAMP
  if (propertyId === "property4") {
    return "CAMP"
  }

  // Property 2 is exclusively Kariv
  if (propertyId === "property2") {
    return "KARIV"
  }

  if (typeof window !== "undefined") {
    const savedLocation = localStorage.getItem("kioskLocation") as KioskLocation

    // Property 3 allows A or B
    if (propertyId === "property3") {
      if (savedLocation === "A" || savedLocation === "B") {
        return savedLocation
      }
      return "A"
    }

    // Property 1
    if (propertyId === "property1") {
      if (savedLocation === "C" || savedLocation === "D") {
        return savedLocation
      }
      return "C"
    }

    return savedLocation || "A" // 기본값은 A동
  }

  // Server side fallback
  if (propertyId === "property3") return "A"
  if (propertyId === "property1") return "C"
  if (propertyId === "property4") return "CAMP"
  if (propertyId === "property2") return "KARIV"

  return "A"
}

// 위치에 따른 지도 이미지 경로 반환
export function getLocationMapPath(location: KioskLocation): string {
  if (location === "CAMP") {
    return `/motel-map-c.png` // 캠프스테이는 C동 지도 사용
  }
  return `/motel-map-${location.toLowerCase()}.png`
}

// 위치에 따른 제목 반환
export function getLocationTitle(location: KioskLocation): string {
  if (location === "CAMP") {
    return "더 캠프스테이"
  }
  if (location === "KARIV") {
    return "Kariv Hotel"
  }
  return `더 비치스테이 ${location}동`
}

// 객실 번호에 따른 건물 확대 이미지 경로 반환
export function getBuildingZoomImagePath(roomNumber: string): string {
  if (!roomNumber || roomNumber.length < 1) {
    return "/hotel-floor-plan.png"
  }

  const normalizedRoomNumber = roomNumber.trim().toUpperCase()

  if (["A131", "A132", "A133", "A135"].includes(normalizedRoomNumber)) {
    return "/building-a-131-135-zoom.png"
  }

  if (["A231", "A232", "A233", "A235"].includes(normalizedRoomNumber)) {
    return "/building-a-231-235-zoom.png"
  }

  if (["A331", "A332", "A333"].includes(normalizedRoomNumber)) {
    return "/building-a-331-333-zoom.png"
  }

  if (["D111", "D112", "D113", "D115"].includes(normalizedRoomNumber)) {
    return "/building-d-111-115-zoom.png"
  }

  if (["D211", "D212", "D213"].includes(normalizedRoomNumber)) {
    return "/building-d-211-213-zoom.png"
  }

  if (["D215", "D216"].includes(normalizedRoomNumber)) {
    return "/building-d-215-216-zoom.png"
  }

  if (["D311", "D312"].includes(normalizedRoomNumber)) {
    return "/building-d-311-312-zoom.png"
  }

  // Camp/Kariv 우선 체크 후, 아니면 기존 첫 글자(A, B, C, D) 사용
  const buildingSection = roomNumber.startsWith("Camp")
    ? "Camp"
    : roomNumber.startsWith("Kariv")
      ? "Kariv"
      : roomNumber.charAt(0).toUpperCase()

  // 유효한 건물 구역인지 확인 (A, B, C, D, Camp, Kariv)
  const validSections = ["A", "B", "C", "D", "Camp", "Kariv"]
  if (!validSections.includes(buildingSection)) {
    return "/hotel-floor-plan.png"
  }

  // zoom 이미지 경로 생성
  return `/building-${buildingSection.toLowerCase()}-zoom.png`
}

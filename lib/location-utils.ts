// 키오스크 위치 타입 정의
export type KioskLocation = "A" | "B" | "CAMP" | "D" | "KARIV"

// 로컬 스토리지에 키오스크 위치 저장
export function saveKioskLocation(location: KioskLocation): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("kioskLocation", location)
  }
}

// 로컬 스토리지에서 키오스크 위치 불러오기
export function getKioskLocation(): KioskLocation {
  if (typeof window !== "undefined") {
    const savedLocation = localStorage.getItem("kioskLocation") as KioskLocation
    return savedLocation || "A" // 기본값은 A동
  }
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

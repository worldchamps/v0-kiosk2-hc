/**
 * 객실 타입과 호수에 맞는 이미지 경로를 반환하는 함수
 */
export function getRoomImagePath(roomType: string, roomNumber: string): string {
  const defaultImagePath = "/hotel-floor-plan.png"

  if (!roomNumber || roomNumber.length < 1) {
    return defaultImagePath
  }

  const buildingSection = roomNumber.startsWith("Camp")
    ? "Camp"
    : roomNumber.startsWith("Kariv")
      ? "Kariv"
      : roomNumber.charAt(0).toUpperCase()

  const validSections = ["A", "B", "C", "D", "Camp", "Kariv"]
  if (!validSections.includes(buildingSection)) {
    return defaultImagePath
  }

  const normalizedRoomType = roomType.trim().toLowerCase()

  let roomTypeKey = ""

  if (normalizedRoomType.includes("스탠다드") && normalizedRoomType.includes("트윈")) {
    roomTypeKey = "스탠다드 트윈"
  } else if (normalizedRoomType.includes("스탠다드")) {
    roomTypeKey = "스탠다드"
  } else if (
    normalizedRoomType.includes("디럭스") &&
    (normalizedRoomType.includes("오션") || normalizedRoomType.includes("오션뷰"))
  ) {
    roomTypeKey = "디럭스 (오션뷰)"
  } else if (normalizedRoomType.includes("디럭스")) {
    roomTypeKey = "디럭스"
  } else if (normalizedRoomType.includes("독채") && normalizedRoomType.includes("펜션")) {
    roomTypeKey = "독채 펜션"
  } else if (normalizedRoomType.includes("독채") && normalizedRoomType.includes("마당")) {
    roomTypeKey = "독채 마당"
  } else if (
    normalizedRoomType.includes("스위트") &&
    (normalizedRoomType.includes("오션") || normalizedRoomType.includes("오션뷰"))
  ) {
    roomTypeKey = "스위트 (오션뷰)"
  } else if (normalizedRoomType.includes("스위트")) {
    roomTypeKey = "스위트"
  }

  if (!roomTypeKey) {
    return defaultImagePath
  }

  const fileName = `${buildingSection} ${roomTypeKey}.jpg`
  const filePath = `/rooms/${fileName}`

  return filePath
}

/**
 * 객실 이미지가 존재하는지 확인하는 함수 (클라이언트 측)
 */
export function checkImageExists(imagePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!imagePath || imagePath === "/hotel-floor-plan.png") {
      resolve(false)
      return
    }

    const img = new Image()
    img.onload = () => {
      resolve(true)
    }
    img.onerror = () => {
      resolve(false)
    }
    img.src = imagePath
  })
}

/**
 * 객실 타입과 호수에 맞는 이미지 경로를 반환하는 함수
 */
export function getRoomImagePath(roomType: string, roomNumber: string): string {
  console.log("[v0] getRoomImagePath 호출:", { roomType, roomNumber })

  // 기본 이미지 경로
  const defaultImagePath = "/hotel-floor-plan.png"

  // 객실 호수가 없거나 유효하지 않은 경우 기본 이미지 반환
  if (!roomNumber || roomNumber.length < 1) {
    console.log("객실 호수가 없거나 유효하지 않음")
    return defaultImagePath
  }

  // 객실 호수의 첫 글자로 건물 구역 확인 (A, B, C, D, K 등)
  const buildingSection = roomNumber.startsWith("Camp")
    ? "Camp"
    : roomNumber.startsWith("Kariv")
      ? "Kariv"
      : roomNumber.charAt(0).toUpperCase()

  console.log("[v0] 추출된 건물 구역:", buildingSection)

  // 유효한 건물 구역인지 확인
  const validSections = ["A", "B", "C", "D", "Camp", "Kariv"]
  if (!validSections.includes(buildingSection)) {
    console.log("유효하지 않은 건물 구역:", buildingSection)
    return defaultImagePath
  }

  // 객실 타입 정규화 (공백 및 대소문자 처리)
  const normalizedRoomType = roomType.trim().toLowerCase()
  console.log("[v0] 정규화된 객실 타입:", normalizedRoomType)

  // 객실 타입에 따른 이미지 매칭
  let roomTypeKey = ""

  if (normalizedRoomType.includes("스탠다드") && normalizedRoomType.includes("더블")) {
    roomTypeKey = "스탠다드"
    console.log("[v0] 매칭: 스탠다드 더블 -> 스탠다드")
  } else if (normalizedRoomType.includes("스탠다드") && normalizedRoomType.includes("트윈")) {
    roomTypeKey = "스탠다드 트윈"
    console.log("[v0] 매칭: 스탠다드 트윈")
  } else if (
    normalizedRoomType.includes("디럭스") &&
    (normalizedRoomType.includes("오션") || normalizedRoomType.includes("오션뷰"))
  ) {
    roomTypeKey = "디럭스 (오션뷰)"
    console.log("[v0] 매칭: 디럭스 + 오션뷰 -> 디럭스 (오션뷰)")
  } else if (normalizedRoomType.includes("디럭스")) {
    roomTypeKey = "디럭스"
    console.log("[v0] 매칭: 디럭스")
  } else if (normalizedRoomType.includes("독채") && normalizedRoomType.includes("펜션")) {
    roomTypeKey = "독채 펜션"
    console.log("[v0] 매칭: 독채 펜션")
  } else if (
    normalizedRoomType.includes("스위트") &&
    (normalizedRoomType.includes("오션") || normalizedRoomType.includes("오션뷰"))
  ) {
    roomTypeKey = "스위트 (오션뷰)"
    console.log("[v0] 매칭: 스위트 + 오션뷰 -> 스위트 (오션뷰)")
  } else if (normalizedRoomType.includes("스위트")) {
    roomTypeKey = "스위트"
    console.log("[v0] 매칭: 스위트")
  }

  // 매칭된 객실 타입이 없는 경우 기본 이미지 반환
  if (!roomTypeKey) {
    console.log("[v0] 매칭된 객실 타입이 없음 - 기본 이미지 사용")
    return defaultImagePath
  }

  // 이미지 파일 경로 생성
  const fileName = `${buildingSection} ${roomTypeKey}.jpg`
  const filePath = `/rooms/${fileName}`

  console.log("[v0] 생성된 이미지 파일명:", fileName)
  console.log("[v0] 생성된 이미지 파일 경로:", filePath)
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
      console.log(`이미지 로드 성공: ${imagePath}`)
      resolve(true)
    }
    img.onerror = () => {
      console.log(`이미지 로드 실패: ${imagePath}`)
      resolve(false)
    }
    img.src = imagePath
  })
}

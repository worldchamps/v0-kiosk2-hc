/**
 * 객실 타입과 호수에 맞는 이미지 경로를 반환하는 함수
 */
export function getRoomImagePath(roomType: string, roomNumber: string): string {
  console.log("[v0] getRoomImagePath 호출:", { roomType, roomNumber })

  // 기본 이미지 경로
  const defaultImagePath = "/hotel-floor-plan.png"

  // 객실 호수가 없거나 유효하지 않은 경우 기본 이미지 반환
  if (!roomNumber || roomNumber.length < 1) {
    console.log("[v0] 객실 호수가 없거나 유효하지 않음")
    return defaultImagePath
  }

  const normalizedRoomType = roomType.trim()
  console.log("[v0] 객실 타입:", normalizedRoomType)

  if (normalizedRoomType.includes("독채 펜션")) {
    const filePath = "/rooms/독채 펜션.jpg"
    console.log("[v0] 매칭: 독채 펜션 ->", filePath)
    return filePath
  }

  if (normalizedRoomType.includes("독채 마당")) {
    const filePath = "/rooms/독채 마당.jpg"
    console.log("[v0] 매칭: 독채 마당 ->", filePath)
    return filePath
  }

  // 객실 호수의 첫 글자로 건물 구역 확인 (A, B, C, D 등)
  const buildingSection = roomNumber.charAt(0).toUpperCase()
  console.log("[v0] 추출된 건물 구역:", buildingSection)

  // 유효한 건물 구역인지 확인
  const validSections = ["A", "B", "C", "D"]
  if (!validSections.includes(buildingSection)) {
    console.log("[v0] 유효하지 않은 건물 구역:", buildingSection)
    return defaultImagePath
  }

  let roomTypeKey = ""

  if (normalizedRoomType === "스탠다드") {
    roomTypeKey = "스탠다드"
    console.log("[v0] 매칭: 스탠다드")
  } else if (normalizedRoomType === "스탠다드 트윈") {
    roomTypeKey = "스탠다드 트윈"
    console.log("[v0] 매칭: 스탠다드 트윈")
  } else if (normalizedRoomType === "디럭스 (오션뷰)") {
    roomTypeKey = "디럭스 (오션뷰)"
    console.log("[v0] 매칭: 디럭스 (오션뷰)")
  } else if (normalizedRoomType === "스위트 (오션뷰)") {
    roomTypeKey = "스위트 (오션뷰)"
    console.log("[v0] 매칭: 스위트 (오션뷰)")
  } else {
    console.log("[v0] 매칭된 객실 타입이 없음:", normalizedRoomType)
    return defaultImagePath
  }

  // 이미지 파일 경로 생성: /rooms/{건물} {타입}.jpg
  const fileName = `${buildingSection} ${roomTypeKey}.jpg`
  const filePath = `/rooms/${fileName}`

  console.log("[v0] 생성된 이미지 경로:", filePath)
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

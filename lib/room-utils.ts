/**
 * 예약 정보의 객실 코드(A131, B223, Camp512 등)를 기반으로 이미지 경로를 반환하는 함수
 * reservation-details에서 사용 (Reservations 시트 기반)
 */
export function getReservationRoomImage(roomNumber: string, roomType: string): string {
  console.log("getReservationRoomImage 호출:", { roomNumber, roomType })

  const defaultImagePath = "/placeholder.svg"

  if (!roomNumber || !roomType) {
    console.log("객실 번호 또는 타입이 없음")
    return defaultImagePath
  }

  // 객실 번호에서 건물 구역 추출 (A131 -> A, B223 -> B, Camp512 -> Camp)
  let buildingSection = ""

  if (roomNumber.startsWith("A")) {
    buildingSection = "A"
  } else if (roomNumber.startsWith("B")) {
    buildingSection = "B"
  } else if (roomNumber.startsWith("C")) {
    buildingSection = "C"
  } else if (roomNumber.startsWith("D")) {
    buildingSection = "D"
  } else if (roomNumber.toLowerCase().startsWith("camp")) {
    buildingSection = "Camp"
  } else if (roomNumber.toLowerCase().startsWith("kariv")) {
    buildingSection = "Kariv"
  } else {
    console.log("유효하지 않은 객실 번호:", roomNumber)
    return defaultImagePath
  }

  // 객실 타입 정규화 (공백 및 대소문자 처리)
  const normalizedRoomType = roomType.trim().toLowerCase()
  console.log("정규화된 객실 타입:", normalizedRoomType)

  // 6개 객실 타입에 따른 정확한 매칭
  let roomTypeKey = ""

  // 정확한 문자열 매칭을 위해 순서 중요 (더 구체적인 것부터)
  if (normalizedRoomType.includes("독채펜션") && normalizedRoomType.includes("마당")) {
    roomTypeKey = "독채펜션(마당)"
  } else if (normalizedRoomType.includes("펜트하우스")) {
    roomTypeKey = "펜트하우스"
  } else if (normalizedRoomType.includes("스위트") && normalizedRoomType.includes("오션뷰")) {
    roomTypeKey = "스위트 (오션뷰)"
  } else if (normalizedRoomType.includes("디럭스") && normalizedRoomType.includes("오션뷰")) {
    roomTypeKey = "디럭스 (오션뷰)"
  } else if (normalizedRoomType.includes("스탠다드 트윈")) {
    roomTypeKey = "스탠다드 트윈"
  } else if (normalizedRoomType.includes("스탠다드")) {
    roomTypeKey = "스탠다드"
  }

  // 매칭된 객실 타입이 없는 경우 기본 이미지 반환
  if (!roomTypeKey) {
    console.log("매칭된 객실 타입이 없음, 기본 이미지 사용")
    return defaultImagePath
  }

  // 이미지 파일 경로 생성
  const fileName = `${buildingSection} ${roomTypeKey}.jpg`
  const filePath = `/rooms/${fileName}`

  console.log("생성된 이미지 파일 경로:", filePath)
  return filePath
}

/**
 * Beach Room Status 시트의 객실 타입을 기반으로 이미지 경로를 반환하는 함수
 * on-site-reservation에서 사용 (Beach Room Status 시트 기반)
 */
export function getBeachRoomImage(roomStyle: string, buildingType: string): string {
  console.log("getBeachRoomImage 호출:", { roomStyle, buildingType })

  const defaultImagePath = "/placeholder.svg"

  // 건물 타입에서 구역 추출
  let buildingSection = ""
  if (buildingType === "Beach A") {
    buildingSection = "A"
  } else if (buildingType === "Beach B") {
    buildingSection = "B"
  } else if (buildingType === "Beach C") {
    buildingSection = "C"
  } else if (buildingType === "Beach D") {
    buildingSection = "D"
  } else if (buildingType === "Camp") {
    buildingSection = "Camp"
  } else if (buildingType === "Kariv") {
    buildingSection = "Kariv"
  } else {
    // 객실번호에서 건물 구역 추출 시도
    if (buildingType.startsWith("A")) {
      buildingSection = "A"
    } else if (buildingType.startsWith("B")) {
      buildingSection = "B"
    } else if (buildingType.startsWith("C")) {
      buildingSection = "C"
    } else if (buildingType.startsWith("D")) {
      buildingSection = "D"
    } else if (buildingType.startsWith("Camp")) {
      buildingSection = "Camp"
    } else if (buildingType.startsWith("Kariv")) {
      buildingSection = "Kariv"
    } else {
      console.log("유효하지 않은 건물 타입:", buildingType)
      return defaultImagePath
    }
  }

  // 객실 타입 정규화 (공백 및 대소문자 처리)
  const normalizedRoomType = roomStyle.trim().toLowerCase()
  console.log("정규화된 객실 타입:", normalizedRoomType)

  // 6개 객실 타입에 따른 정확한 매칭
  let roomTypeKey = ""

  // 정확한 문자열 매칭을 위해 순서 중요 (더 구체적인 것부터)
  if (normalizedRoomType.includes("독채펜션") && normalizedRoomType.includes("마당")) {
    roomTypeKey = "독채펜션(마당)"
  } else if (normalizedRoomType.includes("펜트하우스")) {
    roomTypeKey = "펜트하우스"
  } else if (normalizedRoomType.includes("스위트") && normalizedRoomType.includes("오션뷰")) {
    roomTypeKey = "스위트 (오션뷰)"
  } else if (normalizedRoomType.includes("디럭스") && normalizedRoomType.includes("오션뷰")) {
    roomTypeKey = "디럭스 (오션뷰)"
  } else if (normalizedRoomType.includes("스탠다드 트윈")) {
    roomTypeKey = "스탠다드 트윈"
  } else if (normalizedRoomType.includes("스탠다드")) {
    roomTypeKey = "스탠다드"
  }

  // 매칭된 객실 타입이 없는 경우 기본 이미지 반환
  if (!roomTypeKey) {
    console.log("매칭된 객실 타입이 없음, 기본 이미지 사용")
    return defaultImagePath
  }

  // 이미지 파일 경로 생성
  const fileName = `${buildingSection} ${roomTypeKey}.jpg`
  const filePath = `/rooms/${fileName}`

  console.log("생성된 이미지 파일 경로:", filePath)
  return filePath
}

/**
 * 기존 함수 (하위 호환성을 위해 유지)
 * @deprecated getReservationRoomImage 또는 getBeachRoomImage 사용 권장
 */
export function getRoomImagePath(roomType: string, buildingType: string): string {
  console.log("getRoomImagePath 호출 (deprecated):", { roomType, buildingType })
  return getReservationRoomImage(buildingType, roomType)
}

/**
 * 객실 이미지가 존재하는지 확인하는 함수 (클라이언트 측)
 */
export function checkImageExists(imagePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!imagePath || imagePath === "/placeholder.svg") {
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

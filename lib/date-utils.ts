/**
 * 한국 표준시(KST)로 현재 날짜를 가져오는 함수
 */
export function getCurrentDateKST(): string {
  // UTC 기준 현재 시간
  const now = new Date()

  // 한국 시간으로 변환 (UTC+9)
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000)

  // YYYY-MM-DD 형식으로 반환
  const year = kstDate.getUTCFullYear()
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, "0")
  const day = String(kstDate.getUTCDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

/**
 * 날짜 문자열이 오늘(KST 기준)인지 확인하는 함수
 */
export function isToday(dateString: string): boolean {
  if (!dateString) return false

  // 정규화된 날짜 형식으로 변환
  const normalizedDate = normalizeDate(dateString)
  const today = getCurrentDateKST()

  return normalizedDate === today
}

/**
 * 날짜 형식을 변환하는 함수 (YYYY-MM-DD -> YYYY년 MM월 DD일)
 */
export function formatDateKorean(dateString: string): string {
  if (!dateString) return dateString

  // 정규화된 날짜 형식으로 변환
  const normalizedDate = normalizeDate(dateString)

  if (!normalizedDate) return dateString

  const [year, month, day] = normalizedDate.split("-")
  return `${year}년 ${month}월 ${day}일`
}

/**
 * 날짜 형식을 변환하는 함수 (YYYY-MM-DD -> MM/DD/YYYY)
 */
export function formatDateEnglish(dateString: string): string {
  if (!dateString) return dateString

  // 정규화된 날짜 형식으로 변환
  const normalizedDate = normalizeDate(dateString)

  if (!normalizedDate) return dateString

  const [year, month, day] = normalizedDate.split("-")
  return `${month}/${day}/${year}`
}

/**
 * 다양한 날짜 형식을 YYYY-MM-DD 형식으로 정규화하는 함수
 * 스프레드시트의 날짜 형식이 다양할 수 있으므로 모든 경우를 처리
 */
export function normalizeDate(dateString: string): string {
  if (!dateString) return ""

  // 디버깅을 위한 로그
  console.log(`Normalizing date: "${dateString}"`)

  // 이미 YYYY-MM-DD 형식인 경우
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateString
  }

  // YYYY.MM.DD 형식인 경우
  if (dateString.match(/^\d{4}\.\d{2}\.\d{2}$/)) {
    return dateString.replace(/\./g, "-")
  }

  // 스프레드시트 날짜 형식 (YYYY. MM. DD)
  const spreadsheetMatch = dateString.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})$/)
  if (spreadsheetMatch) {
    const [_, year, month, day] = spreadsheetMatch
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }

  // MM/DD/YYYY 형식인 경우
  const mmddyyyyMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyyMatch) {
    const [_, month, day, year] = mmddyyyyMatch
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }

  // 다른 형식의 날짜 문자열을 파싱 시도
  try {
    const date = new Date(dateString)
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")
      return `${year}-${month}-${day}`
    }
  } catch (e) {
    console.error("Failed to parse date:", dateString)
  }

  // 정규화 실패 시 원본 반환
  console.warn(`Failed to normalize date: "${dateString}"`)
  return dateString
}

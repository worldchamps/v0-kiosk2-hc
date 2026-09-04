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

  const cleaned = String(dateString).replace(/^'/, "").trim()

  // 이미 YYYY-MM-DD 형식인 경우
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return cleaned
  }

  // YYYY.MM.DD 형식인 경우
  if (cleaned.match(/^\d{4}\.\d{2}\.\d{2}$/)) {
    return cleaned.replace(/\./g, "-")
  }

  // Google Sheets 날짜/날짜시간: 2026. 9. 5 오전 11:00:00, 26.09.05/11:00
  const spreadsheetMatch = cleaned.match(/^(\d{2}|\d{4})[.-]\s*(\d{1,2})[.-]\s*(\d{1,2})(?:\.?(?:\s|\/|T|$))/)
  if (spreadsheetMatch) {
    const [_, year, month, day] = spreadsheetMatch
    const fullYear = year.length === 2 ? `20${year}` : year
    return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }

  // MM/DD/YYYY 형식인 경우
  const mmddyyyyMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyyMatch) {
    const [_, month, day, year] = mmddyyyyMatch
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }

  // 다른 형식의 날짜 문자열을 파싱 시도
  try {
    const date = new Date(cleaned)
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")
      return `${year}-${month}-${day}`
    }
  } catch (e) {
    console.error("Failed to parse date:", cleaned)
  }

  // 정규화 실패 시 원본 반환
  console.warn(`Failed to normalize date: "${cleaned}"`)
  return cleaned
}

const getTime = (value: string, fallback: string) => {
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return fallback

  let hour = Number(match[1])
  if (/(오후|pm)/i.test(value) && hour < 12) hour += 12
  if (/(오전|am)/i.test(value) && hour === 12) hour = 0
  return `${String(hour).padStart(2, "0")}:${match[2]}`
}

const buildScheduledAt = (date: string, time: string) => {
  const match = normalizeDate(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[1].slice(-2)}.${match[2]}.${match[3]}/${time}` : ""
}

export const resolveReservationSheetDateTime = (
  dateValue: string | undefined,
  scheduledValue: string | undefined,
  fallbackTime: string,
) => {
  const primaryDate = normalizeDate(String(dateValue || ""))
  if (/^\d{4}-\d{2}-\d{2}$/.test(primaryDate)) {
    const timeSource = /\d{1,2}:\d{2}/.test(String(dateValue || "")) ? String(dateValue) : String(scheduledValue || "")
    return buildScheduledAt(primaryDate, getTime(timeSource, fallbackTime))
  }

  const legacyDate = normalizeDate(String(scheduledValue || ""))
  return /^\d{4}-\d{2}-\d{2}$/.test(legacyDate)
    ? buildScheduledAt(legacyDate, getTime(String(scheduledValue), fallbackTime))
    : ""
}

export const formatCurrentSheetDateTime = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  return `${parts.year}.${parts.month}.${parts.day}/${parts.hour}:${parts.minute}`
}

export const buildOnSiteSheetDateTimes = (
  checkInDate: string,
  checkOutDate: string,
  stayType: "overnight" | "shortStay",
  now = new Date(),
) => {
  const currentTime = getTime(formatCurrentSheetDateTime(now), "00:00")
  const checkInAt = buildScheduledAt(checkInDate, currentTime)
  let checkOutAt = buildScheduledAt(checkOutDate, "11:00")

  if (stayType === "shortStay") {
    const start = new Date(`${normalizeDate(checkInDate)}T${currentTime}:00+09:00`)
    checkOutAt = formatCurrentSheetDateTime(new Date(start.getTime() + 3 * 60 * 60 * 1000))
  }

  return {
    checkInDate: checkInAt,
    checkOutDate: checkOutAt,
    scheduledCheckInAt: checkInAt,
    scheduledCheckOutAt: checkOutAt,
  }
}

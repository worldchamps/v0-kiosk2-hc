export type StayType = "overnight" | "shortStay"

const SHORT_STAY_RATES = [
  { keyword: "디럭스", price: 30000 },
  { keyword: "스위트", price: 50000 },
  { keyword: "스탠다드", price: 30000 },
]

const OVERNIGHT_RANGES: Record<string, Array<{ keyword: string; min: number; max: number }>> = {
  A: [
    { keyword: "스위트", min: 90000, max: 150000 },
    { keyword: "디럭스", min: 60000, max: 100000 },
    { keyword: "스탠다드", min: 50000, max: 80000 },
  ],
  B: [
    { keyword: "디럭스 (오션뷰)", min: 60000, max: 100000 },
    { keyword: "디럭스", min: 60000, max: 90000 },
    { keyword: "스탠다드", min: 50000, max: 80000 },
  ],
  C: [
    { keyword: "스위트", min: 150000, max: 250000 },
    { keyword: "스탠다드 (취사)", min: 80000, max: 120000 },
    { keyword: "스탠다드 트윈", min: 70000, max: 100000 },
    { keyword: "스탠다드", min: 50000, max: 80000 },
  ],
  D: [
    { keyword: "스탠다드 (취사)", min: 80000, max: 120000 },
    { keyword: "디럭스", min: 60000, max: 100000 },
    { keyword: "스탠다드", min: 50000, max: 80000 },
  ],
}

// 공휴일/대체공휴일은 운영 전에 연도별 검토한다. 연휴에 붙은 주말도 아래 로직에서 최대가로 처리한다.
const KOREAN_PUBLIC_HOLIDAYS = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02",
  "2026-05-05", "2026-05-24", "2026-05-25", "2026-06-06", "2026-08-15", "2026-08-17",
  "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", "2026-10-03", "2026-10-05",
  "2026-10-09", "2026-12-25",
])

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date)
}

function dayOfWeek(date: Date) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(date)
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday)
}

function shiftedKey(date: Date, days: number) {
  return dateKey(new Date(date.getTime() + days * 86400000))
}

function isHolidayPeriod(date: Date) {
  const key = dateKey(date)
  if (KOREAN_PUBLIC_HOLIDAYS.has(key)) return true
  const day = dayOfWeek(date)
  return (day === 6 && KOREAN_PUBLIC_HOLIDAYS.has(shiftedKey(date, 2))) ||
    (day === 0 && (KOREAN_PUBLIC_HOLIDAYS.has(shiftedKey(date, -2)) || KOREAN_PUBLIC_HOLIDAYS.has(shiftedKey(date, 1))))
}

function isPeakSeason(date: Date) {
  const key = dateKey(date)
  const ranges = (process.env.NEXT_PUBLIC_PEAK_SEASON_RANGES || "").split(",").filter(Boolean)
  return ranges.some((range) => {
    const [start, end = start] = range.trim().split("~")
    return Boolean(start && key >= start && key <= end)
  })
}

export function getOnSiteRate(building: string, roomType: string, stayType: StayType, date = new Date()) {
  if (stayType === "shortStay") return SHORT_STAY_RATES.find(({ keyword }) => roomType.includes(keyword))?.price

  const normalizedBuilding = building.toUpperCase().trim()
  const code = normalizedBuilding.match(/(?:BEACH\s+)?([ABCD])(?:동)?$/)?.[1] || normalizedBuilding.match(/^([ABCD])\d*/)?.[1]
  const range = code ? OVERNIGHT_RANGES[code]?.find(({ keyword }) => roomType.includes(keyword)) : undefined
  if (!range) return undefined
  if (isPeakSeason(date) || isHolidayPeriod(date)) return range.max
  return Math.min(range.min + (dayOfWeek(date) === 0 || dayOfWeek(date) === 6 ? 10000 : 0), range.max)
}

export const VARIABLE_RATE_NOTICE = "요금은 평일 기본가이며, 주말에는 1만원이 추가됩니다. 성수기·공휴일·연휴에는 최대 요금이 적용됩니다."

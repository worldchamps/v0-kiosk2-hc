import { NextResponse } from 'next/server'
import { createSheetsClient } from '@/lib/google-sheets'
import { getAvailableRooms } from '@/lib/firebase-beach-rooms'
import { getKioskScope, isRoomInBuilding } from '@/lib/kiosk-scope'
import { getPropertyFromRoomNumber } from '@/lib/property-utils'
import { bookingRoomKey, roomScheduleConflicts } from '@/lib/on-site-bookings'
import { buildOnSiteSheetDateTimes, formatCurrentSheetDateTime, normalizeDate } from '@/lib/date-utils'
import { findKioskRoomSalesConfig, getKioskSalesConfig, isKioskSalesWindowOpen } from '@/lib/kiosk-sales-config'
import { getPmsRateAmount } from '@/lib/pms-rates'
import { isShortStayAvailable, isShortStayRestrictedProperty } from '@/lib/short-stay-policy'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const reject = (error: string, status = 409) => NextResponse.json({ ready: false, error }, { status, headers: { 'Cache-Control': 'no-store' } })
  try {
    const params = new URL(request.url).searchParams, roomCode = bookingRoomKey(params.get('roomCode') || ''), stayType = params.get('stayType')
    const scope = getKioskScope(), property = getPropertyFromRoomNumber(roomCode)
    if (!property || property !== scope.property || !isRoomInBuilding(roomCode, scope.building)) return reject('이 키오스크에서 판매할 수 없는 객실입니다.', 403)
    if (stayType !== 'overnight' && stayType !== 'shortStay') return reject('이용 유형을 확인해 주세요.', 400)
    const config = await getKioskSalesConfig(property), room = findKioskRoomSalesConfig(config, roomCode)
    if (config && (!room?.enabled || !room[stayType === 'overnight' ? 'overnightEnabled' : 'shortStayEnabled'] || !isKioskSalesWindowOpen(config.policy, stayType)))
      return reject('현재 판매가 중지된 객실 또는 이용 유형입니다.')
    if (!config && stayType === 'shortStay' && isShortStayRestrictedProperty(property) && !isShortStayAvailable()) return reject('현재 대실을 판매할 수 없습니다.')
    const vacant = await getAvailableRooms(scope.building || undefined)
    if (!vacant.some(item => bookingRoomKey(item.matchingRoomNumber) === roomCode)) return reject('현재 입실 가능한 객실이 아닙니다. 다른 객실을 선택해 주세요.')
    const now = new Date()
    const dates = buildOnSiteSheetDateTimes(normalizeDate(formatCurrentSheetDateTime(now)), normalizeDate(formatCurrentSheetDateTime(new Date(now.getTime() + 86400000))), stayType, now,
      { shortStayDurationMinutes: config?.policy.shortStayDurationMinutes, overnightCheckoutTime: config?.policy.overnightCheckoutTime })
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    if (!spreadsheetId) return reject('예약 일정을 확인하지 못했습니다. 결제를 시작하지 않았습니다.', 503)
    const rows = (await createSheetsClient().spreadsheets.values.get({ spreadsheetId, range: 'Reservations!A:N',
      valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }, { timeout: 15000, retry: false })).data.values || []
    if (roomScheduleConflicts(rows, roomCode, dates.checkInDate, dates.checkOutDate)) return reject('이용시간이 다른 예약 또는 청소 준비 시간과 겹칩니다. 다른 객실을 선택해 주세요.')
    const rates = config ? room?.rates[stayType] : { cash: await getPmsRateAmount({ roomCode, stayType, paymentMethod: 'CASH' }), card: await getPmsRateAmount({ roomCode, stayType, paymentMethod: 'CARD' }) }
    return NextResponse.json({ ready: true, rates }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return reject('예약 일정을 확인하지 못했습니다. 결제를 시작하지 않았습니다. 잠시 후 다시 선택해 주세요.', 503) }
}

export async function checkOnSiteBeforePayment(roomCode: string, stayType: string, rates: { cash?: number | null; card?: number | null } | null | undefined) {
  const response = await fetch(`/api/on-site-preflight?${new URLSearchParams({ roomCode, stayType })}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
  const result = await response.json()
  if (!response.ok || result.ready !== true) throw Error(result.error || '예약 일정을 확인하지 못했습니다. 결제를 시작하지 않았습니다.')
  if (!result.rates || Number(result.rates.cash || 0) !== Number(rates?.cash || 0) || Number(result.rates.card || 0) !== Number(rates?.card || 0))
    throw Error('판매 금액이 변경되었습니다. 객실 목록을 새로 확인해 주세요. 결제를 시작하지 않았습니다.')
}

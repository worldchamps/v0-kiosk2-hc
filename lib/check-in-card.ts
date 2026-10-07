import type { CardKeyResult } from "@/types/electron"

export function cardFailure(result: CardKeyResult): string {
  const messages: Record<string, string> = {
    disabled: "카드 발급기 설정이 필요합니다.", disconnected: "카드 발급기가 연결되지 않았습니다.",
    room_not_registered: "이 객실의 원본 카드가 아직 등록되지 않았습니다.", empty: "발급할 카드가 없습니다.",
    card_present: "발급기에 카드가 남아 있습니다.", inspection_required: "발급기 안의 카드 확인이 필요합니다.",
    not_taken: "카드를 가져가지 않아 회수했습니다.", busy: "장비가 다른 작업을 처리하고 있습니다.",
  }
  return messages[result.reason || ""] || "카드를 발급하지 못했습니다."
}

export async function checkCardBeforePayment(room: string, reservationId?: string): Promise<void> {
  const api = window.electronAPI?.cardKey
  if (!api || !await api.checkInRequired?.()) return
  if (!await api.available()) return
  const result = await api.ready(room, reservationId)
  if (!result.success) throw new Error(cardFailure(result) + " 관리자에게 문의해주세요.")
}

export async function issueCheckInCard(authorization?: { required: boolean; ticket?: string }): Promise<CardKeyResult | undefined> {
  if (!authorization?.required) return undefined
  const api = window.electronAPI?.cardKey
  if (!api?.issueCheckIn || !authorization.ticket) return { success: false, reason: "disabled", settled: true }
  try {
    // Wait for the just-finished payment device to become idle. Only a busy
    // response (no card movement) may be retried automatically.
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = await api.issueCheckIn(authorization.ticket)
      if (result.reason !== "busy") return result
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return { success: false, reason: "busy", settled: true }
  } catch { return { success: false, reason: "inspection_required", settled: false } }
}

export const assistantTopics = {
  availability: "현재 이 키오스크에서 판매할 수 있는 객실이 있는지 묻는 질문",
  checkin: "예약 확인이나 체크인을 어떻게 진행하는지 묻는 질문",
  transfer: "계좌이체나 결제 방법을 묻는 질문",
  key: "객실 키, 비밀번호, 출입 방법을 묻는 질문",
  directions: "객실, 건물, 층 또는 키오스크에서 어디로 가야 하는지 묻는 질문",
  checkout: "체크아웃 날짜 또는 시간을 묻는 질문",
  payment: "카드나 현금 결제 오류, 중복 결제 또는 결제 결과 확인을 묻는 질문",
  reservation: "예약이 조회되지 않거나 예약 정보를 찾는 방법을 묻는 질문",
  other: "위 주제와 관련 없는 질문이나 뜻이 불분명한 질문",
} as const

export type AssistantTopic = keyof typeof assistantTopics

export function suggestedQuestions(screen: string): string[] {
  if (screen.includes("payment")) return ["결제가 안 돼요", "계좌이체 가능한가요?", "체크인 어떻게 해요?"]
  if (screen === "checkInComplete" || screen === "onSiteReservation:complete") return ["키는 어디 있나요?", "어디로 가야 하나요?", "체크아웃은 몇 시인가요?"]
  if (screen.startsWith("reservation")) return ["체크인 어떻게 해요?", "예약이 안 나와요", "체크아웃은 몇 시인가요?"]
  return ["객실이 있나요?", "체크인 어떻게 해요?", "계좌이체 가능한가요?"]
}

export function assistantAnswer(topic: AssistantTopic, context: {
  screen: string
  building: string | null
  availableCount?: number | null
  checkoutAt?: string | null
  roomNumber?: string | null
}): string {
  const { screen, building, availableCount, checkoutAt, roomNumber } = context
  const complete = screen === "checkInComplete" || screen === "onSiteReservation:complete"
  switch (topic) {
    case "availability":
      if (availableCount === null || availableCount === undefined) return "지금은 객실 현황을 확인하지 못했습니다. 화면에서 다시 확인하거나 관리자에게 문의해 주세요."
      if (availableCount === 0) return `현재 이 키오스크${building ? `(${building}동)` : ""}에서 판매 가능한 객실이 없습니다. 객실 현황은 바뀔 수 있으니 화면에서 다시 확인해 주세요.`
      return `현재 이 키오스크${building ? `(${building}동)` : ""}에서 판매 가능한 객실이 ${availableCount}개 있습니다. 화면에서 숙박 또는 대실을 선택해 객실을 확인해 주세요. 객실 현황은 결제 전 다시 확인됩니다.`
    case "checkin":
      if (screen === "reservationNotFound") return "예약이 보이지 않으면 예약자 이름과 예약 날짜를 다시 확인해 주세요. 계속 찾지 못하면 관리자에게 문의해 주세요."
      if (screen === "reservationDetails") return "예약 내용을 확인한 뒤 화면의 체크인 버튼을 눌러 주세요. 처리가 끝나면 객실 입실 정보가 표시됩니다."
      if (complete) return "체크인이 완료된 화면입니다. 표시된 객실번호와 출입 안내를 확인해 주세요."
      return "이미 예약하셨다면 화면의 ‘이미 예약했어요’를 눌러 예약을 찾은 뒤 체크인을 진행해 주세요. 현장 예약은 숙박 또는 대실을 선택해 시작할 수 있습니다."
    case "transfer":
      return "키오스크 결제 화면에서는 카드와 현금을 선택할 수 있습니다. 계좌이체 안내는 첫 화면에 표시되어 있으며, 입금 확인과 예약 처리 방법은 관리자에게 문의해 주세요."
    case "key":
      return complete
        ? "체크인 완료 화면에서 객실번호와 출입 안내를 확인해 주세요. 안내지가 출력되는 경우에도 같은 내용을 확인할 수 있습니다. 입실 정보가 보이지 않으면 관리자에게 문의해 주세요."
        : "체크인을 마치면 객실번호와 출입 방법이 화면에 표시됩니다. 먼저 예약 확인과 체크인을 완료해 주세요."
    case "directions":
      if (complete && roomNumber) return `${roomNumber} 객실로 이동해 주세요. 동과 층은 객실번호 및 완료 화면의 안내를 확인해 주세요.`
      return "체크인이 끝나면 완료 화면에 객실번호와 입실 안내가 표시됩니다. 표시된 동과 층을 확인해 이동해 주세요."
    case "checkout":
      return checkoutAt
        ? `현재 예약 화면에 표시된 퇴실 일시는 ${checkoutAt}입니다. 예약별 시간이 다를 수 있으니 안내 내용을 확인해 주세요.`
        : "퇴실 일시는 예약에 따라 다를 수 있습니다. 예약 확인 화면이나 객실 안내지의 퇴실 일시를 확인해 주세요. 확인이 어려우면 관리자에게 문의해 주세요."
    case "payment":
      return "결제 화면에 표시된 상태를 먼저 확인해 주세요. 카드 승인이나 현금 처리 결과가 불분명하다면 추가 결제를 하지 말고 관리자에게 문의해 주세요. 이 도우미는 결제 결과를 확정하거나 다시 결제하지 않습니다."
    case "reservation":
      return "‘이미 예약했어요’를 눌러 예약자 이름 또는 예약 QR로 다시 찾아보세요. 예약 날짜나 이름이 다르게 등록되었을 수 있습니다. 계속 보이지 않으면 관리자에게 문의해 주세요."
    default:
      return "예약 확인, 객실, 체크인, 결제 방법, 키와 이동 경로, 퇴실 시간에 관해 물어봐 주세요. 해결되지 않으면 관리자에게 문의해 주세요."
  }
}

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

export function isAssistantTopic(value: unknown): value is AssistantTopic {
  return typeof value === "string" && Object.hasOwn(assistantTopics, value)
}

export const assistantVoiceStyles = {
  calm: "한국어 호텔 안내를 하는 20대 여성 직원처럼 밝고 부드럽게 말하세요. 답은 바로 시작하고 자연스러운 빠른 속도로 읽되 서두르거나 들뜨지 마세요. 짧은 문장 사이만 가볍게 쉬고, 버튼 이름은 또렷하게 발음하세요. 과장된 감탄, 광고 말투, 군더더기 인사는 피하세요.",
  friendly: "밝고 친근한 안내 직원처럼 자연스럽게 말하세요. 지나치게 들뜨지 않고 편안한 존댓말을 사용하세요.",
  concise: "간결하고 또렷한 안내 방송처럼 말하세요. 숫자와 객실번호는 알아듣기 쉽게 천천히 읽으세요.",
} as const

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
}): string {
  const { screen, building, availableCount } = context
  const complete = screen === "checkInComplete" || screen === "onSiteReservation:complete"
  switch (topic) {
    case "availability":
      if (availableCount === null || availableCount === undefined) return "객실 현황을 확인하지 못했습니다. 직원에게 연락해 주세요."
      if (availableCount === 0) return `현재 ${building ? `${building}동에` : "이 키오스크에"} 판매 가능한 객실이 없습니다. 직원에게 연락해 주세요.`
      return `현재 ${building ? `${building}동에` : "이 키오스크에"} 판매 가능한 객실이 ${availableCount}개 있습니다. 화면의 숙박 또는 대실을 눌러 확인해 주세요.`
    case "checkin":
      if (screen === "reservationNotFound") return "예약자 이름과 날짜를 다시 확인해 주세요. 계속 보이지 않으면 직원에게 연락해 주세요."
      if (screen === "reservationDetails") return "화면의 체크인 버튼을 눌러 주세요."
      if (complete) return "완료 화면의 객실번호와 출입 방법을 확인해 주세요."
      return "화면의 ‘이미 예약했어요’를 눌러 주세요."
    case "transfer":
      return "계좌이체는 첫 화면의 안내를 확인해 주세요. 확인이 어려우면 직원에게 연락해 주세요."
    case "key":
      return complete
        ? "완료 화면의 객실번호와 출입 안내를 확인해 주세요. 보이지 않으면 직원에게 연락해 주세요."
        : "먼저 화면의 체크인 안내를 따라 주세요."
    case "directions":
      return "완료 화면에 표시된 동과 층을 확인해 주세요."
    case "checkout":
      return "예약 확인 화면의 퇴실 일시를 확인해 주세요. 보이지 않으면 직원에게 연락해 주세요."
    case "payment":
      return "결제 결과가 불분명하면 추가 결제를 하지 말고 직원에게 연락해 주세요."
    case "reservation":
      return "화면의 ‘이미 예약했어요’를 눌러 주세요. 조회되지 않으면 직원에게 연락해 주세요."
    default:
      return "무엇이 어려운지 한 가지만 다시 말씀해 주세요."
  }
}

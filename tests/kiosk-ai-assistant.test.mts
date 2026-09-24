import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { assistantAnswer, suggestedQuestions } from "../lib/kiosk-assistant-content.ts"
import { createSpeechToken, verifySpeechToken } from "../lib/kiosk-assistant-speech.ts"

test("assistant keeps availability scoped and ambiguous payments safe", () => {
  assert.match(assistantAnswer("availability", { screen: "onSiteReservation:stayType", building: "A", availableCount: 2 }), /A동.*2개/)
  assert.doesNotMatch(assistantAnswer("availability", { screen: "onSiteReservation:stayType", building: "A", availableCount: null }), /0개/)
  assert.match(assistantAnswer("payment", { screen: "onSiteReservation:payment", building: "A" }), /추가 결제를 하지 말고/)
  assert.deepEqual(suggestedQuestions("onSiteReservation:payment")[0], "결제가 안 돼요")
})

test("speech output is restricted to a recent approved answer", () => {
  const text = "현재 객실을 확인해 주세요."
  const key = "test-secret"
  const token = createSpeechToken(text, key, 1_800_000_000_000)
  assert(verifySpeechToken(text, token, key, 1_800_000_010_000))
  assert(!verifySpeechToken("다른 문장", token, key, 1_800_000_010_000))
  assert(!verifySpeechToken(text, token, key, 1_800_000_121_000))
})

test("planning package defines the approved field pilot gate and record form", () => {
  const doc = readFileSync(new URL("../docs/KIOSK_AI_ASSISTANT.md", import.meta.url), "utf8")
  assert.match(doc, /운영 장비 설치는 별도 승인 전까지 하지 않습니다/)
  assert.match(doc, /대표 디지털 취약 사용자 5명/)
  assert.match(doc, /5명 중 4명 이상.*독립 완료/)
  assert.match(doc, /위험한 오안내가 0건/)
  assert.match(doc, /기록 양식/)
  assert.match(doc, /직원 연락 전환 사유/)
  assert.match(doc, /직원 조작 없이 전체 완료한 사용자 수\(5명 중 4명 이상이어야 통과\)/)
  assert.match(doc, /위험한 오안내 총건수\(0건이어야 통과\)/)
  assert.match(doc, /현장 결과는 운영 장비 설치 승인 후 별도 판정/)
})

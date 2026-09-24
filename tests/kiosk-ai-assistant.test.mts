import test from "node:test"
import assert from "node:assert/strict"
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

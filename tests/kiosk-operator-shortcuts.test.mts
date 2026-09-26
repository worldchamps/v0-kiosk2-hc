import assert from "node:assert/strict"
import test from "node:test"
import { kioskOperatorShortcut } from "../lib/kiosk-operator-shortcuts.ts"

test("operator shortcuts require deliberate keys and never use plain Backspace", () => {
  const key = (key: string, ctrlKey = false, shiftKey = false, altKey = false, repeat = false) =>
    kioskOperatorShortcut({ key, ctrlKey, shiftKey, altKey, repeat })
  assert.equal(key("Backspace"), null)
  assert.equal(key("Backspace", true), null)
  assert.equal(key("Backspace", true, true), "admin")
  assert.equal(key("Backspace", true, true, true), null)
  assert.equal(key("Backspace", true, true, false, true), null)
  assert.equal(key("m", true, true), "cursor")
  assert.equal(key("M", true, true), "cursor")
})

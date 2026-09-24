import { createHmac, timingSafeEqual } from "node:crypto"

function signature(text: string, issuedAt: number, key: string) {
  return createHmac("sha256", key).update(`${issuedAt}:${text}`).digest("hex")
}

export function createSpeechToken(text: string, key: string, issuedAt = Date.now()) {
  return `${issuedAt}.${signature(text, issuedAt, key)}`
}

export function verifySpeechToken(text: string, token: string, key: string, now = Date.now()) {
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token)
  if (!match) return false
  const issuedAt = Number(match[1])
  if (issuedAt > now || now - issuedAt > 120000) return false
  return timingSafeEqual(Buffer.from(match[2], "hex"), Buffer.from(signature(text, issuedAt, key), "hex"))
}

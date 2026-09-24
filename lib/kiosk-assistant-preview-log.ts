export function previewSessionId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null
}

export function logAssistantPreview(event: string, details: Record<string, string | number | null>) {
  if (process.env.VERCEL_ENV !== "preview") return
  console.info("[kiosk-ai-preview]", JSON.stringify({ event, ...details }))
}

export function kioskOperatorShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "repeat">): "admin" | "cursor" | null {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.repeat) return null
  if (event.key === "Backspace") return "admin"
  return event.key.toLowerCase() === "m" ? "cursor" : null
}

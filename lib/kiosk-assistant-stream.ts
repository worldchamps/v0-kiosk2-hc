export async function readAssistantStream(response: Response, onDelta: (text: string) => void) {
  if (!response.ok || !response.body) throw new Error("안내를 확인하지 못했습니다.")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: { topic?: string; speechToken?: string } | null = null
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === "delta" && typeof event.text === "string") onDelta(event.text)
      if (event.type === "error") throw new Error(event.text || "안내를 확인하지 못했습니다.")
      if (event.type === "done") result = event
    }
    if (done) break
  }
  if (!result) throw new Error("안내 응답이 중단되었습니다. 다시 질문해 주세요.")
  return result
}

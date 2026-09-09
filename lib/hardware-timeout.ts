// IPC can stall before a device packet is sent. Bound that wait too, and consume late rejections.
export async function hardwareCallWithin<T>(call: () => Promise<T>, milliseconds = 1000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(call).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, milliseconds)) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

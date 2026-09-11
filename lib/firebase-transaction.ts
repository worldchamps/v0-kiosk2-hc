import type { Reference } from "firebase-admin/database"

// A one-shot read drops its cache when the listener detaches. A subsequent
// transaction then sees null and an undefined result aborts before server sync.
// Keep this reference observed until Firebase's compare-and-set has finished.
export async function transactionWithReadCache(ref: Reference, update: Parameters<Reference["transaction"]>[0]) {
  const keepCached = () => {}
  ref.on("value", keepCached)
  try {
    await ref.once("value")
    return await ref.transaction(update)
  } finally {
    ref.off("value", keepCached)
  }
}

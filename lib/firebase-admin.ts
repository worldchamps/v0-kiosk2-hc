import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getDatabase, type Database } from "firebase-admin/database"
import { getPropertyFromRoomNumber } from "@/lib/property-utils"
import { createHash } from "crypto"

let dbInstance: Database | null = null

// Firebase Admin SDK 초기화 (서버 사이드)
function initFirebase(): Database | null {
  // Skip initialization during build time or if env vars are missing
  if (typeof window !== "undefined") {
    return null
  }

  const requiredEnvVars = {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
    FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,
  }

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    console.error("[Firebase Admin] Missing environment variables:", missingVars.join(", "))
    console.error("[Firebase Admin] Please check your .env.local file")
    return null
  }

  if (dbInstance) {
    return dbInstance
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
          privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL!,
      })
    }
    dbInstance = getDatabase()
    console.log("[Firebase Admin] Successfully initialized")
    return dbInstance
  } catch (error) {
    console.error("[Firebase Admin] Initialization error:", error)
    return null
  }
}

export function getDB(): Database {
  if (!dbInstance) {
    const db = initFirebase()
    if (!db) {
      throw new Error("Firebase is not initialized. Check environment variables.")
    }
    return db
  }
  return dbInstance
}

export const db = new Proxy({} as Database, {
  get(target, prop) {
    return getDB()[prop as keyof Database]
  },
})

export async function addToPMSQueue(data: {
  roomNumber: string
  guestName: string
  checkInDate: string
}) {
  console.log("[Firebase] addToPMSQueue called with:", data)

  const property = getPropertyFromRoomNumber(data.roomNumber)
  console.log("[Firebase] Detected property:", property, "for room:", data.roomNumber)

  const database = getDB()
  const ref = database.ref(`pms_queue/${property}`)
  console.log("[Firebase] Firebase path:", `pms_queue/${property}`)

  // Generate a key without writing
  const newRef = ref.push()
  const newKey = newRef.key

  if (!newKey) {
    throw new Error("Failed to generate Firebase key")
  }

  console.log("[Firebase] Generated queue ID:", newKey)

  const queueData = {
    id: newKey,
    action: "checkin",
    roomNumber: data.roomNumber,
    guestName: data.guestName,
    checkInDate: data.checkInDate,
    status: "pending",
    property: property,
    createdAt: new Date().toISOString(),
    // completedAt is omitted effectively by not including it or setting it if we needed.
    // Firebase doesn't support 'undefined' well, and 'null' deletes the key.
    // We just omit it for now.
  }

  console.log("[Firebase] Queue data to be saved:", JSON.stringify(queueData, null, 2))

  // Use update to atomically add the child
  await ref.update({
    [newKey]: queueData
  })

  console.log(`[Firebase] ✅ Successfully added to ${property} queue:`, data.roomNumber)
  return newKey
}

function paymentClaimKey(payToken: string) {
  return createHash("sha256").update(payToken).digest("hex")
}

export async function claimPayment(
  provider: "toss_pay" | "toss_front",
  paymentId: string,
  details: Record<string, string | number>,
) {
  const database = getDB()
  const ref = database.ref(`payment_claims/${provider}/${paymentClaimKey(paymentId)}`)
  const result = await ref.transaction((current) => {
    if (current) return
    return {
      ...details,
      status: "claimed",
      claimedAt: new Date().toISOString(),
    }
  })
  return result.committed
}

export async function releasePaymentClaim(provider: "toss_pay" | "toss_front", paymentId: string) {
  const database = getDB()
  await database.ref(`payment_claims/${provider}/${paymentClaimKey(paymentId)}`).remove()
}

export async function claimTossPayment(payToken: string, orderNo: string) {
  return claimPayment("toss_pay", payToken, { orderNo })
}

export async function releaseTossPaymentClaim(payToken: string) {
  await releasePaymentClaim("toss_pay", payToken)
}

// PMS Queue 항목을 완료 처리
export async function completePMSQueueItem(property: string, id: string) {
  const database = getDB()
  const ref = database.ref(`pms_queue/${property}/${id}`)
  await ref.update({
    status: "completed",
    completedAt: new Date().toISOString(),
  })
}

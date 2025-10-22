import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getDatabase, type Database } from "firebase-admin/database"

let dbInstance: Database | null = null

// Firebase Admin SDK 초기화 (서버 사이드)
function initFirebase(): Database | null {
  // Skip initialization during build time or if env vars are missing
  if (
    typeof window !== "undefined" ||
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY ||
    !process.env.FIREBASE_DATABASE_URL
  ) {
    console.warn("[Firebase] Skipping initialization - missing environment variables or build time")
    return null
  }

  if (dbInstance) {
    return dbInstance
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      })
    }
    dbInstance = getDatabase()
    return dbInstance
  } catch (error) {
    console.error("[Firebase] Initialization error:", error)
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

export function getPropertyFromRoomNumber(roomNumber: string): string {
  const upperRoom = roomNumber.toUpperCase().trim()

  // Property 1: C### or D### pattern
  if (upperRoom.match(/^[CD]\d{3}$/)) {
    return "property1"
  }

  // Property 3: A### 또는 B### 형식
  if (upperRoom.match(/^[AB]\d{3}$/)) {
    return "property3"
  }

  // Property 4: Camp ### 형식 (공백 있거나 없거나)
  if (upperRoom.match(/^CAMP\s*\d+$/i)) {
    return "property4"
  }

  // Property 2: Kariv ### pattern
  if (upperRoom.match(/^KARIV\s*\d+$/i)) {
    return "property2"
  }

  // 기본값: property3 (기존 동작 유지)
  return "property3"
}

export async function addToPMSQueue(data: {
  roomNumber: string
  guestName: string
  checkInDate: string
}) {
  console.log("[Firebase] addToPMSQueue called with:", data)

  // 호실 번호로 속성 결정
  const property = getPropertyFromRoomNumber(data.roomNumber)
  console.log("[Firebase] Detected property:", property, "for room:", data.roomNumber)

  const database = getDB()
  const ref = database.ref(`pms_queue/${property}`)
  console.log("[Firebase] Firebase path:", `pms_queue/${property}`)

  const newRef = ref.push()
  console.log("[Firebase] Generated queue ID:", newRef.key)

  const queueData = {
    id: newRef.key,
    action: "checkin",
    roomNumber: data.roomNumber,
    guestName: data.guestName,
    checkInDate: data.checkInDate,
    status: "pending",
    property: property,
    createdAt: new Date().toISOString(),
    completedAt: null,
  }

  console.log("[Firebase] Queue data to be saved:", queueData)

  await newRef.set(queueData)

  console.log(`[Firebase] ✅ Successfully added to ${property} queue:`, data.roomNumber)
  return newRef.key
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

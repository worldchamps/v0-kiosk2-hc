import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getDatabase } from "firebase-admin/database"

// Firebase Admin SDK 초기화 (서버 사이드)
function initFirebase() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    })
  }
  return getDatabase()
}

export const db = initFirebase()

export function getPropertyFromRoomNumber(roomNumber: string): string {
  const upperRoom = roomNumber.toUpperCase().trim()

  console.log("[v0] Routing room number:", roomNumber, "→", upperRoom)

  // Property 3: A### 또는 B### 형식
  if (upperRoom.match(/^[AB]\d{3}$/)) {
    console.log("[v0] Matched property3 (A/B rooms)")
    return "property3"
  }

  if (upperRoom.match(/^CAMP\s*\d+$/i)) {
    console.log("[v0] Matched property4 (Camp rooms)")
    return "property4"
  }

  // Property 1 & 2는 독립적인 PMS 사용 (Firebase 불필요)
  // C###, D### → Property 1 (독립 PMS)
  // Kariv ### → Property 2 (독립 PMS)

  // 기본값: property3 (기존 동작 유지)
  console.log("[v0] No match, defaulting to property3")
  return "property3"
}

export async function addToPMSQueue(data: {
  roomNumber: string
  guestName: string
  checkInDate: string
}) {
  const property = getPropertyFromRoomNumber(data.roomNumber)

  console.log("[v0] Firebase Queue Data:", {
    roomNumber: data.roomNumber,
    guestName: data.guestName,
    checkInDate: data.checkInDate,
    property: property,
  })

  // 속성별 경로에 데이터 저장
  const ref = db.ref(`pms_queue/${property}`)
  const newRef = ref.push()

  const queueData = {
    id: newRef.key,
    action: "checkin",
    roomNumber: data.roomNumber, // 원본 객실 번호 사용 (공백 유지)
    guestName: data.guestName,
    checkInDate: data.checkInDate,
    status: "pending",
    property: property,
    createdAt: new Date().toISOString(),
    completedAt: null,
  }

  console.log("[v0] Writing to Firebase path:", `pms_queue/${property}/${newRef.key}`)
  console.log("[v0] Queue data:", JSON.stringify(queueData, null, 2))

  await newRef.set(queueData)

  console.log(`[v0] Successfully added to ${property} queue:`, data.roomNumber)
  return newRef.key
}

// PMS Queue 항목을 완료 처리
export async function completePMSQueueItem(property: string, id: string) {
  const ref = db.ref(`pms_queue/${property}/${id}`)
  await ref.update({
    status: "completed",
    completedAt: new Date().toISOString(),
  })
}

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

// PMS Queue에 체크인 정보 추가
export async function addToPMSQueue(data: {
  roomNumber: string
  guestName: string
  checkInDate: string
}) {
  const ref = db.ref("pms_queue")
  const newRef = ref.push()

  await newRef.set({
    id: newRef.key,
    roomNumber: data.roomNumber,
    guestName: data.guestName,
    checkInDate: data.checkInDate,
    status: "pending",
    createdAt: new Date().toISOString(),
    completedAt: null,
  })

  return newRef.key
}

// PMS Queue 항목을 완료 처리
export async function completePMSQueueItem(id: string) {
  const ref = db.ref(`pms_queue/${id}`)
  await ref.update({
    status: "completed",
    completedAt: new Date().toISOString(),
  })
}

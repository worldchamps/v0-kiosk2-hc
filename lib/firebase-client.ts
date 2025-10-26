import { initializeApp, getApps } from "firebase/app"
import { getDatabase, type Database } from "firebase/database"

// Firebase client configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app: any = null
let database: Database | null = null

// Initialize Firebase (client-side only, not during build)
function initFirebase() {
  if (typeof window === "undefined") {
    // Skip during SSR/build
    return null
  }

  if (!firebaseConfig.databaseURL || !firebaseConfig.projectId) {
    console.warn("[Firebase Client] Missing required configuration (databaseURL or projectId)")
    return null
  }

  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig)
    } else {
      app = getApps()[0]
    }
    return app
  } catch (error) {
    console.error("[Firebase Client] Initialization error:", error)
    return null
  }
}

export function getFirebaseDatabase(): Database | null {
  if (!database) {
    const firebaseApp = initFirebase()
    if (firebaseApp) {
      try {
        database = getDatabase(firebaseApp)
      } catch (error) {
        console.error("[Firebase Client] Failed to get database:", error)
        return null
      }
    }
  }
  return database
}

// Export initialized database (will be null if not initialized)
export { database }

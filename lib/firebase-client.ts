import { initializeApp, getApps } from "firebase/app"
import { getDatabase } from "firebase/database"

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
let database: any = null

// Initialize Firebase (client-side only, not during build)
function initFirebase() {
  if (typeof window === "undefined") {
    // Skip during SSR/build
    return null
  }

  if (!firebaseConfig.databaseURL || !firebaseConfig.projectId) {
    console.warn("[Firebase Client] Missing required configuration")
    return null
  }

  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig)
  } else {
    app = getApps()[0]
  }

  return app
}

export function getFirebaseDatabase() {
  if (!database) {
    const firebaseApp = initFirebase()
    if (firebaseApp) {
      database = getDatabase(firebaseApp)
    }
  }
  return database
}

// Export for backward compatibility
export { database }

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

/**
 * Firebase config is loaded from Vite env vars.
 *
 * Create a `.env.local` file in the project root with:
 * - VITE_FIREBASE_API_KEY
 * - VITE_FIREBASE_AUTH_DOMAIN
 * - VITE_FIREBASE_PROJECT_ID
 * - VITE_FIREBASE_STORAGE_BUCKET (optional)
 * - VITE_FIREBASE_MESSAGING_SENDER_ID (optional)
 * - VITE_FIREBASE_APP_ID
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

const missingKeys = Object.entries(firebaseConfig)
  .filter(([k, v]) => (k === 'storageBucket' || k === 'messagingSenderId' ? false : !v))
  .map(([k]) => k)

if (missingKeys.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `[firebase] Missing required config keys: ${missingKeys.join(
      ', ',
    )}. Did you create .env.local with VITE_FIREBASE_*?`,
  )
}

export const firebaseApp = initializeApp(firebaseConfig)

export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
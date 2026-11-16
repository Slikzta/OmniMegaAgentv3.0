import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type Auth, type User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { useState, useEffect } from 'react';
import rawFirebaseConfig from '../../firebase-applet-config.json';

// Read Firebase API key from environment variable (FIREBASE_API_KEY or shared GEMINI_API_KEY)
const resolvedApiKey =
  (typeof process !== 'undefined' && (process.env?.FIREBASE_API_KEY || process.env?.GEMINI_API_KEY)) ||
  rawFirebaseConfig.apiKey ||
  '';

const hasValidApiKey = Boolean(resolvedApiKey && resolvedApiKey.trim().length > 0);

const firebaseConfig = {
  ...rawFirebaseConfig,
  apiKey: resolvedApiKey,
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

if (hasValidApiKey) {
  try {
    app = initializeApp(firebaseConfig);
    authInstance = getAuth(app);
    dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    googleProviderInstance = new GoogleAuthProvider();
  } catch (err) {
    console.warn("Failed to initialize Firebase with provided credentials:", err);
    app = null;
    authInstance = null;
    dbInstance = null;
    googleProviderInstance = null;
  }
}

export const auth: Auth | null = authInstance;
export const db: Firestore | null = dbInstance;
export const googleProvider: GoogleAuthProvider | null = googleProviderInstance;

export const signInWithGoogle = async () => {
  if (auth && googleProvider) {
    return signInWithPopup(auth, googleProvider);
  }
  console.warn("Firebase Auth is not configured. Google Sign-In is unavailable.");
  return null;
};

export const logout = async () => {
  if (auth) {
    return signOut(auth);
  }
};

/**
 * Safe replacement for useAuthState that never throws when Firebase Auth is null/unconfigured.
 */
export function useSafeAuthState(): readonly [User | null, boolean, Error | undefined] {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = auth.onAuthStateChanged(
      (u) => {
        setUser(u);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  return [user, loading, error] as const;
}

// Connection test
async function testConnection() {
  if (!hasValidApiKey || !db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

if (hasValidApiKey && db) {
  testConnection();
}

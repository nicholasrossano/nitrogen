'use client';

import { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import type { User, Auth } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEV_AUTH_BYPASS_STORAGE_KEY = 'nitrogen_dev_auth_bypass';
const DEV_AUTH_BYPASS_TOKEN = 'mock-token';

function isLocalDevelopmentHost(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return (
    process.env.NODE_ENV !== 'production' &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  );
}

function createDevBypassUser(): User {
  const nowIso = new Date().toISOString();
  const expiryIso = new Date(Date.now() + 3600000).toISOString();
  return {
    uid: 'shared-user',
    email: 'shared@nitrogen.ai',
    emailVerified: true,
    displayName: 'Local Dev User',
    isAnonymous: false,
    photoURL: null,
    providerData: [],
    metadata: {} as User['metadata'],
    phoneNumber: null,
    tenantId: null,
    refreshToken: '',
    providerId: 'mock',
    delete: async () => {},
    getIdToken: async () => DEV_AUTH_BYPASS_TOKEN,
    getIdTokenResult: async () => ({
      token: DEV_AUTH_BYPASS_TOKEN,
      claims: {},
      authTime: nowIso,
      issuedAtTime: nowIso,
      expirationTime: expiryIso,
      signInProvider: 'mock',
      signInSecondFactor: null,
    }),
    reload: async () => {},
    toJSON: () => ({}),
  };
}


export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<Auth | null>(null);

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
      try {
        const { getAuth, onAuthStateChanged } = await import('firebase/auth');
        const { app } = await import('./firebase');
        
        const authInstance = getAuth(app);
        setAuth(authInstance);
        window.localStorage.removeItem(DEV_AUTH_BYPASS_STORAGE_KEY);
        
        unsubscribe = onAuthStateChanged(authInstance, (user) => {
          setUser(user);
          setLoading(false);
        });
      } catch (error) {
        if (isLocalDevelopmentHost()) {
          window.localStorage.setItem(DEV_AUTH_BYPASS_STORAGE_KEY, 'true');
          setUser(createDevBypassUser());
          setLoading(false);
          console.warn('Firebase auth init failed locally; using dev bypass user.', error);
          return;
        }
        console.error('Failed to initialize Firebase auth:', error);
        setLoading(false);
      }
    };

    initAuth();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    await signInWithEmailAndPassword(auth, email, password);
  }, [auth]);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    await createUserWithEmailAndPassword(auth, email, password);
  }, [auth]);

  const signInWithGoogle = useCallback(async () => {
    if (!auth) throw new Error('Auth not initialized');
    const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, [auth]);

  const signOut = useCallback(async () => {
    if (!auth) {
      if (isLocalDevelopmentHost()) {
        window.localStorage.removeItem(DEV_AUTH_BYPASS_STORAGE_KEY);
        setUser(null);
        return;
      }
      throw new Error('Auth not initialized');
    }
    const { signOut: firebaseSignOut } = await import('firebase/auth');
    await firebaseSignOut(auth);
  }, [auth]);

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(auth, email);
  }, [auth]);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (
      isLocalDevelopmentHost() &&
      window.localStorage.getItem(DEV_AUTH_BYPASS_STORAGE_KEY) === 'true'
    ) {
      return DEV_AUTH_BYPASS_TOKEN;
    }
    return user.getIdToken();
  }, [user]);

  const value = useMemo(() => ({
    user,
    loading,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    resetPassword,
    getIdToken,
  }), [user, loading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, resetPassword, getIdToken]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

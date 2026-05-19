'use client';

import { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import type { User, Auth } from 'firebase/auth';

import { createDevMockUser, getDevMockToken, isDevMockAuthEnabled } from '@/lib/devAuth';

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


export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<Auth | null>(null);

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
      if (isDevMockAuthEnabled()) {
        setUser(createDevMockUser());
        setLoading(false);
        return;
      }

      try {
        const { getAuth, onAuthStateChanged } = await import('firebase/auth');
        const { app } = await import('./firebase');

        const authInstance = getAuth(app);
        setAuth(authInstance);

        unsubscribe = onAuthStateChanged(authInstance, (nextUser) => {
          setUser(nextUser);
          setLoading(false);
        });
      } catch (error) {
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
    if (isDevMockAuthEnabled()) {
      setUser(createDevMockUser());
      return;
    }
    if (!auth) throw new Error('Auth not initialized');
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    await signInWithEmailAndPassword(auth, email, password);
  }, [auth]);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    if (isDevMockAuthEnabled()) {
      setUser(createDevMockUser());
      return;
    }
    if (!auth) throw new Error('Auth not initialized');
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    await createUserWithEmailAndPassword(auth, email, password);
  }, [auth]);

  const signInWithGoogle = useCallback(async () => {
    if (isDevMockAuthEnabled()) {
      setUser(createDevMockUser());
      return;
    }
    if (!auth) throw new Error('Auth not initialized');
    const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, [auth]);

  const signOut = useCallback(async () => {
    if (isDevMockAuthEnabled()) {
      setUser(null);
      return;
    }
    if (!auth) throw new Error('Auth not initialized');
    const { signOut: firebaseSignOut } = await import('firebase/auth');
    await firebaseSignOut(auth);
  }, [auth]);

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(auth, email);
  }, [auth]);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!user) return isDevMockAuthEnabled() ? getDevMockToken() : null;
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

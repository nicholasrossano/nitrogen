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

function isFirebaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!isFirebaseConfigured()) {
      setConfigError(
        'Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* vars to root .env and restart the dev server.',
      );
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
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
        setConfigError('Failed to initialize Firebase auth. Check NEXT_PUBLIC_FIREBASE_* in .env.');
        setLoading(false);
      }
    };

    void initAuth();

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
    if (!user) return null;
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

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-surface">
        <div className="max-w-md text-center space-y-2">
          <p className="text-sm font-medium text-text-primary">Firebase auth required</p>
          <p className="text-xs text-text-secondary">{configError}</p>
        </div>
      </div>
    );
  }

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

'use client';

import { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import type { User, Auth } from 'firebase/auth';
import { isDemoActive } from '@/lib/demo/demoSession';
import { leaveDemoSession } from '@/lib/demo/demoBoundary';
import { syncAuthSessionBoundary } from '@/lib/sessionBoundary';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  reloadUser: () => Promise<User | null>;
  getIdToken: () => Promise<string | null>;
}

/** True when the signed-in user must verify email before using the app. */
export function needsEmailVerification(user: User | null | undefined): boolean {
  return Boolean(user && !user.emailVerified);
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
          // Real auth always wins — except while /demo is still bootstrapping
          // (sign-out may emit a stale user once before null).
          if (nextUser && isDemoActive()) {
            leaveDemoSession();
          }
          // Drop cross-account workspace / last-project / tour prefs when the
          // Firebase UID changes so new signups never inherit another user's IDs.
          syncAuthSessionBoundary(nextUser?.uid ?? null);
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
    const {
      createUserWithEmailAndPassword,
      sendEmailVerification,
    } = await import('firebase/auth');
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    // Best-effort: account exists even if the verification email fails to send.
    try {
      await sendEmailVerification(credential.user);
    } catch (err) {
      console.error('Failed to send verification email after signup:', err);
    }
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

  const sendVerificationEmail = useCallback(async () => {
    if (!auth?.currentUser) throw new Error('Not signed in');
    const { sendEmailVerification } = await import('firebase/auth');
    await sendEmailVerification(auth.currentUser);
  }, [auth]);

  const reloadUser = useCallback(async (): Promise<User | null> => {
    if (!auth?.currentUser) return null;
    await auth.currentUser.reload();
    // Force a fresh ID token so backend sees updated email_verified.
    await auth.currentUser.getIdToken(true);
    const next = auth.currentUser;
    setUser(next);
    return next;
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
    sendVerificationEmail,
    reloadUser,
    getIdToken,
  }), [
    user,
    loading,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    resetPassword,
    sendVerificationEmail,
    reloadUser,
    getIdToken,
  ]);

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

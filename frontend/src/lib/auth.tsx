'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

// Auto-bypass auth on localhost (development only)
const isDevBypassEnabled = () => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return (
    process.env.NODE_ENV === 'development' &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  );
};

// Check if access code bypass is enabled (production demo mode)
const isAccessCodeBypassEnabled = () => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('nitrogen_access_granted') === 'true';
};

// Mock user for development bypass
const createMockUser = (): User => ({
  uid: 'dev-user-123',
  email: 'dev@localhost.com',
  emailVerified: true,
  displayName: 'Dev User',
  isAnonymous: false,
  photoURL: null,
  providerData: [],
  metadata: {} as User['metadata'],
  phoneNumber: null,
  tenantId: null,
  refreshToken: '',
  providerId: 'mock',
  delete: async () => {},
  getIdToken: async () => 'mock-token',
  getIdTokenResult: async () => ({
    token: 'mock-token',
    claims: {},
    authTime: new Date().toISOString(),
    issuedAtTime: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 3600000).toISOString(),
    signInProvider: 'mock',
    signInSecondFactor: null,
  }),
  reload: async () => {},
  toJSON: () => ({}),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<Auth | null>(null);

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    // Dev bypass mode - skip Firebase auth entirely
    if (isDevBypassEnabled()) {
      console.log('🔓 Dev auth bypass enabled - using mock user');
      setUser(createMockUser());
      setLoading(false);
      return;
    }

    // Access code bypass mode - skip Firebase auth entirely
    if (isAccessCodeBypassEnabled()) {
      console.log('🔓 Access code bypass enabled - using shared user');
      setUser(createMockUser());
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
        
        unsubscribe = onAuthStateChanged(authInstance, (user) => {
          setUser(user);
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

  const signInWithEmail = async (email: string, password: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email: string, password: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const signInWithGoogle = async () => {
    if (!auth) throw new Error('Auth not initialized');
    const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const signOut = async () => {
    // In dev bypass mode, just clear the mock user
    if (isDevBypassEnabled()) {
      setUser(null);
      return;
    }
    // In access code bypass mode, clear the access code
    if (isAccessCodeBypassEnabled()) {
      localStorage.removeItem('nitrogen_access_granted');
      setUser(null);
      // Force a page reload to show the access code gate again
      window.location.href = '/';
      return;
    }
    if (!auth) throw new Error('Auth not initialized');
    const { signOut: firebaseSignOut } = await import('firebase/auth');
    await firebaseSignOut(auth);
  };

  const resetPassword = async (email: string) => {
    if (!auth) throw new Error('Auth not initialized');
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(auth, email);
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!user) return null;
    // In dev bypass mode, return a mock token
    if (isDevBypassEnabled()) {
      return 'REDACTED_DEV_TOKEN';
    }
    // In access code bypass mode, return a mock token
    if (isAccessCodeBypassEnabled()) {
      return 'REDACTED_DEV_TOKEN';
    }
    return user.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
        resetPassword,
        getIdToken,
      }}
    >
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

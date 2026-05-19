import type { User } from 'firebase/auth';

export const DEV_MOCK_USER_UID = 'shared-user';
export const DEV_MOCK_USER_EMAIL = 'shared@nitrogen.ai';

export function isFirebaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim());
}

/** True when local dev runs without Firebase client config (shared mock user). */
export function isDevMockAuthEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && !isFirebaseConfigured();
}

export function getDevMockToken(): string {
  return process.env.NEXT_PUBLIC_DEV_MOCK_TOKEN?.trim() || 'dev-mock-token';
}

export function createDevMockUser(): User {
  const token = getDevMockToken();
  return {
    uid: DEV_MOCK_USER_UID,
    email: DEV_MOCK_USER_EMAIL,
    emailVerified: true,
    displayName: 'Dev User',
    isAnonymous: false,
    providerData: [],
    refreshToken: '',
    tenantId: null,
    metadata: {},
    phoneNumber: null,
    photoURL: null,
    providerId: 'dev-mock',
    delete: async () => {},
    getIdToken: async () => token,
    getIdTokenResult: async () => ({
      token,
      authTime: '',
      issuedAtTime: '',
      expirationTime: '',
      signInProvider: 'dev-mock',
      signInSecondFactor: null,
      claims: {},
    }),
    reload: async () => {},
    toJSON: () => ({}),
  } as unknown as User;
}

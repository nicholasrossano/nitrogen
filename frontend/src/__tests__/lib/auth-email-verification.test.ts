import { needsEmailVerification } from '@/lib/auth';
import type { User } from 'firebase/auth';

function mockUser(emailVerified: boolean): User {
  return { emailVerified } as User;
}

describe('needsEmailVerification', () => {
  it('is false for null/undefined', () => {
    expect(needsEmailVerification(null)).toBe(false);
    expect(needsEmailVerification(undefined)).toBe(false);
  });

  it('is true when email is not verified', () => {
    expect(needsEmailVerification(mockUser(false))).toBe(true);
  });

  it('is false when email is verified', () => {
    expect(needsEmailVerification(mockUser(true))).toBe(false);
  });
});

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';

type AuthMode = 'signin' | 'signup' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword, user, loading } = useAuth();
  
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // If already logged in, redirect to home
  if (!loading && user) {
    router.push('/');
    return null;
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'reset') {
        await resetPassword(email);
        setResetSent(true);
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password);
        router.push('/');
      } else {
        await signInWithEmail(email, password);
        router.push('/');
      }
    } catch (err: any) {
      const errorCode = err?.code || '';
      if (errorCode === 'auth/user-not-found') {
        setError('No account found with this email.');
      } else if (errorCode === 'auth/wrong-password') {
        setError('Incorrect password.');
      } else if (errorCode === 'auth/email-already-in-use') {
        setError('An account with this email already exists.');
      } else if (errorCode === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else if (errorCode === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (errorCode === 'auth/invalid-credential') {
        setError('Invalid email or password.');
      } else {
        setError(err?.message || 'An error occurred. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setSubmitting(true);

    try {
      await signInWithGoogle();
      router.push('/');
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'Failed to sign in with Google.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-[72px] px-6 flex items-center">
        <h1 className="text-xl font-display font-semibold text-text-primary tracking-tight">
          Nitrogen AI
        </h1>
      </header>
      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Card */}
          <div className="bg-surface rounded-lg shadow-workspace p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-display font-semibold text-text-primary mb-2">
                {mode === 'reset' 
                  ? 'Reset Password' 
                  : mode === 'signup' 
                    ? 'Create Account' 
                    : 'Welcome Back'}
              </h2>
              <p className="text-text-secondary text-sm">
                {mode === 'reset'
                  ? 'Enter your email to receive a reset link'
                  : mode === 'signup'
                    ? 'Sign up to start generating investment memos'
                    : 'Sign in to continue to Nitrogen'}
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-6 p-3 bg-indicator-orange/10 border border-indicator-orange/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-indicator-orange mt-0.5 shrink-0" />
                <p className="text-sm text-indicator-orange">{error}</p>
              </div>
            )}

            {/* Reset sent message */}
            {resetSent && mode === 'reset' && (
              <div className="mb-6 p-3 bg-indicator-green/10 border border-indicator-green/20">
                <p className="text-sm text-indicator-green">
                  Password reset email sent. Check your inbox.
                </p>
              </div>
            )}

            {/* Google Sign In */}
            {mode !== 'reset' && (
              <>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={submitting}
                  className="w-full btn-secondary mb-4"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-stroke-subtle" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-text-tertiary">or</span>
                  </div>
                </div>
              </>
            )}

            {/* Email/Password Form */}
            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full h-11 pl-10 pr-4 bg-white border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                      required
                      minLength={6}
                      className="w-full h-11 pl-10 pr-4 bg-white border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full btn-primary h-11"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : mode === 'reset' ? (
                  'Send Reset Link'
                ) : mode === 'signup' ? (
                  'Create Account'
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            {/* Mode switchers */}
            <div className="mt-6 text-center space-y-2">
              {mode === 'signin' && (
                <>
                  <button
                    onClick={() => { setMode('reset'); setError(null); setResetSent(false); }}
                    className="text-sm text-text-secondary hover:text-accent transition-colors"
                  >
                    Forgot password?
                  </button>
                  <p className="text-sm text-text-secondary">
                    Don&apos;t have an account?{' '}
                    <button
                      onClick={() => { setMode('signup'); setError(null); }}
                      className="text-accent hover:text-accent-anchor font-medium transition-colors"
                    >
                      Sign up
                    </button>
                  </p>
                </>
              )}

              {mode === 'signup' && (
                <p className="text-sm text-text-secondary">
                  Already have an account?{' '}
                  <button
                    onClick={() => { setMode('signin'); setError(null); }}
                    className="text-accent hover:text-accent-anchor font-medium transition-colors"
                  >
                    Sign in
                  </button>
                </p>
              )}

              {mode === 'reset' && (
                <button
                  onClick={() => { setMode('signin'); setError(null); setResetSent(false); }}
                  className="text-sm text-accent hover:text-accent-anchor font-medium transition-colors"
                >
                  Back to sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

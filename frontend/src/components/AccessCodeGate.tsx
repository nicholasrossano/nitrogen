'use client';

import { useState, useEffect, ReactNode } from 'react';
import { Loader2, Lock, AlertCircle } from 'lucide-react';

interface AccessCodeGateProps {
  children: ReactNode;
}

const ACCESS_CODE = 'REDACTED_ACCESS_CODE';
const STORAGE_KEY = 'nitrogen_access_granted';

export function AccessCodeGate({ children }: AccessCodeGateProps) {
  const [accessGranted, setAccessGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Check if access was previously granted
    const granted = localStorage.getItem(STORAGE_KEY);
    if (granted === 'true') {
      setAccessGranted(true);
    }
    setLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // Simulate a brief check delay for UX
    setTimeout(() => {
      if (code === ACCESS_CODE) {
        localStorage.setItem(STORAGE_KEY, 'true');
        setAccessGranted(true);
      } else {
        setError('Incorrect access code. Please try again.');
      }
      setSubmitting(false);
    }, 300);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (accessGranted) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-[72px] px-6 flex items-center bg-white">
        <h1 className="text-xl font-display font-semibold text-text-primary tracking-tight">
          Nitrogen AI
        </h1>
      </header>
      <div className="divider-accent" />

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Card */}
          <div className="bg-white border border-stroke-subtle p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-display font-semibold text-text-primary mb-2">
                Welcome to Nitrogen
              </h2>
              <p className="text-text-secondary text-sm">
                Enter your access code to continue
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-6 p-3 bg-indicator-orange/10 border border-indicator-orange/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-indicator-orange mt-0.5 shrink-0" />
                <p className="text-sm text-indicator-orange">{error}</p>
              </div>
            )}

            {/* Access Code Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="accessCode" className="block text-sm font-medium text-text-primary mb-1.5">
                  Access Code
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                  <input
                    id="accessCode"
                    type="password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Enter access code"
                    required
                    className="w-full h-11 pl-10 pr-4 bg-white border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !code}
                className="w-full btn-primary h-11"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Continue'
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

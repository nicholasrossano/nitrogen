'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, InviteValidation } from '@/lib/api';

type InviteState = 'loading' | 'valid' | 'accepting' | 'error';

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const { user, loading: authLoading } = useAuth();

  const [state, setState] = useState<InviteState>('loading');
  const [invite, setInvite] = useState<InviteValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acceptedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    api.validateInvite(token)
      .then((data) => {
        setInvite(data);
        setState('valid');
      })
      .catch((err) => {
        setError(err?.message || 'This invitation link is invalid or has expired.');
        setState('error');
      });
  }, [token]);

  useEffect(() => {
    if (authLoading || state !== 'valid') return;

    if (!user) {
      router.replace(`/login?returnUrl=/invite/${token}`);
      return;
    }

    if (acceptedRef.current) return;
    acceptedRef.current = true;

    setState('accepting');
    api.acceptInvite(token)
      .then((result) => {
        router.replace(`/initiatives/${result.initiative_id}`);
      })
      .catch((err) => {
        setError(err?.message || 'Failed to accept invitation.');
        setState('error');
      });
  }, [authLoading, user, state, token, router]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-[72px] px-6 flex items-center">
        <h1 className="text-xl font-display font-semibold text-text-primary tracking-tight">
          Nitrogen AI
        </h1>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-surface rounded-lg shadow-workspace p-8 text-center">
            {state === 'error' ? (
              <>
                <div className="w-12 h-12 rounded-full bg-indicator-red/10 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-6 h-6 text-indicator-red" />
                </div>
                <h2 className="text-lg font-semibold text-text-primary mb-2">
                  Invitation unavailable
                </h2>
                <p className="text-sm text-text-secondary mb-6">{error}</p>
                <button
                  onClick={() => router.push('/')}
                  className="btn-secondary text-sm"
                >
                  Go to home
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                  {state === 'loading' || state === 'accepting' ? (
                    <Loader2 className="w-6 h-6 text-accent animate-spin" />
                  ) : (
                    <UserPlus className="w-6 h-6 text-accent" />
                  )}
                </div>
                <h2 className="text-lg font-semibold text-text-primary mb-2">
                  {state === 'accepting'
                    ? 'Setting up your project...'
                    : invite?.project_title
                      ? `You're invited to "${invite.project_title}"`
                      : 'You have been invited to a project'}
                </h2>
                <p className="text-sm text-text-secondary">
                  {state === 'accepting'
                    ? 'Setting up your access...'
                    : invite?.invited_by_name
                      ? `${invite.invited_by_name} has invited you to collaborate on this project.`
                      : 'Verifying invitation...'}
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

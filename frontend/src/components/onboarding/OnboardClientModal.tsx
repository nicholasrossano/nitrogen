'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, UserPlus, Check, Copy, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface OnboardClientModalProps {
  onClose: () => void;
}

export function OnboardClientModal({ onClose }: OnboardClientModalProps) {
  const [clientEmail, setClientEmail] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 150);
  }, [onClose]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.createInitiativeAndInvite(
        clientEmail || undefined,
        projectTitle || undefined,
      );
      const baseUrl = window.location.origin;
      setInviteLink(`${baseUrl}/invite/${result.token}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create invite link');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const modal = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-white shadow-2xl border border-stroke-subtle">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <UserPlus className="w-3.5 h-3.5 text-accent" />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">Onboard client</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {!inviteLink ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <p className="text-xs text-text-secondary">
                Create a project and generate an invite link for your client.
                They will describe the project, upload documents, and review the generated plan.
              </p>

              <div>
                <label htmlFor="onboard-email" className="block text-xs font-medium text-text-primary mb-1.5">
                  Client email <span className="text-text-tertiary font-normal">(optional)</span>
                </label>
                <input
                  id="onboard-email"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@company.com"
                  className="w-full h-9 px-3 text-sm bg-white border border-stroke-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label htmlFor="onboard-title" className="block text-xs font-medium text-text-primary mb-1.5">
                  Project title <span className="text-text-tertiary font-normal">(optional)</span>
                </label>
                <input
                  id="onboard-title"
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="e.g. Ghana Solar Mini-Grid"
                  className="w-full h-9 px-3 text-sm bg-white border border-stroke-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                />
              </div>

              {error && (
                <p className="text-xs text-indicator-red">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full btn-primary h-9 text-sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create invite link'
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-indicator-green/10 rounded-lg">
                <Check className="w-4 h-4 text-indicator-green shrink-0" />
                <p className="text-xs text-indicator-green font-medium">
                  Invite link created
                </p>
              </div>

              <p className="text-xs text-text-secondary">
                Share this link with your client. They will be able to sign up (or log in) and start the project onboarding.
              </p>

              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 h-9 px-3 text-xs bg-surface-subtle border border-stroke-subtle rounded-lg text-text-primary select-all focus:outline-none"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={handleCopy}
                  className="btn-secondary shrink-0 !h-9 !px-3 !text-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>

              <button
                onClick={handleClose}
                className="w-full btn-secondary h-9 text-sm"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

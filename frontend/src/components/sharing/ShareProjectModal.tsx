'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UserPlus, Loader2, Users } from 'lucide-react';
import { api, ProjectShare, UserSearchResult } from '@/lib/api';
import { AccessMemberRow } from './AccessMemberRow';
import { EmailAddressField } from './EmailAddressField';
import { RoleDropdown } from './RoleDropdown';

interface ShareProjectModalProps {
  projectId: string;
  ownerEmail?: string | null;
  onClose: () => void;
}

export function ShareProjectModal({ projectId, ownerEmail, onClose }: ShareProjectModalProps) {
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 150);
  }, [onClose]);

  useEffect(() => {
    api.getShares(projectId).then(setShares).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (email.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.searchUsers(email);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setSearchResults([]);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [email]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleShare = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const share = await api.createShare(projectId, email.trim(), role);
      setShares(prev => [...prev, share]);
      setEmail('');
      setSearchResults([]);
      setShowDropdown(false);
    } catch (err: any) {
      const msg = err?.message || 'Failed to share';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (shareId: string, newRole: 'editor' | 'viewer') => {
    try {
      const updated = await api.updateShare(projectId, shareId, newRole);
      setShares(prev => prev.map(s => s.id === shareId ? updated : s));
    } catch {
      setError('Failed to update role');
    }
  };

  const handleRemove = async (shareId: string) => {
    try {
      await api.deleteShare(projectId, shareId);
      setShares(prev => prev.filter(s => s.id !== shareId));
    } catch {
      setError('Failed to remove access');
    }
  };

  const selectSearchResult = (result: UserSearchResult) => {
    setEmail(result.email || '');
    setShowDropdown(false);
    inputRef.current?.focus();
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
              <Users className="w-3.5 h-3.5 text-accent" />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">Share project</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Invite form */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1" ref={dropdownRef}>
              <EmailAddressField
                ref={inputRef}
                value={email}
                onChange={setEmail}
                onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleShare(); }}
                className="w-full flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-stroke-subtle bg-white focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stroke-subtle rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => selectSearchResult(r)}
                      className="w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-surface-subtle transition-colors flex items-center gap-2"
                    >
                      <span className="truncate">{r.email}</span>
                      {r.display_name && (
                        <span className="text-text-tertiary truncate">({r.display_name})</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <RoleDropdown
              value={role}
              onChange={(value) => setRole(value as 'editor' | 'viewer')}
              options={[
                { value: 'editor', label: 'Editor' },
                { value: 'viewer', label: 'Viewer' },
              ]}
              disabled={submitting}
              buttonClassName="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-surface border border-stroke-subtle text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/20 disabled:opacity-50"
            />
            <button
              onClick={handleShare}
              disabled={submitting || !email.trim()}
              className="btn-primary !h-9 !px-3.5 !text-xs !rounded-lg shrink-0 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Share
            </button>
          </div>
          {error && (
            <p className="text-xs text-indicator-orange">{error}</p>
          )}
        </div>

        {/* Shares list */}
        <div className="px-5 pb-5">
          <div className="border border-stroke-subtle rounded-lg divide-y divide-stroke-subtle">
            {/* Owner row */}
            <AccessMemberRow
              emailOrId={ownerEmail || 'You'}
              roleLabel="Owner"
              accentAvatar={true}
            />

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
              </div>
            ) : shares.filter(s => s.user_email !== ownerEmail).length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-text-tertiary">No one else has access yet</p>
              </div>
            ) : (
              shares.filter(s => s.user_email !== ownerEmail).map((share) => (
                <AccessMemberRow
                  key={share.id}
                  emailOrId={share.user_email || share.user_id || 'Invited'}
                  displayName={share.pending ? 'Invited — no account yet' : share.user_display_name}
                  roleValue={share.role}
                  roleOptions={[
                    { value: 'editor', label: 'Editor' },
                    { value: 'viewer', label: 'Viewer' },
                  ]}
                  onRoleChange={(value) => handleRoleChange(share.id, value as 'editor' | 'viewer')}
                  onRemove={() => handleRemove(share.id)}
                  removeTitle={share.pending ? 'Cancel invitation' : 'Remove access'}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

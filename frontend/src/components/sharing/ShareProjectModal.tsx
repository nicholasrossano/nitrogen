'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UserPlus, ChevronDown, Trash2, Loader2, Users } from 'lucide-react';
import { api, ProjectShare, UserSearchResult } from '@/lib/api';

interface ShareProjectModalProps {
  initiativeId: string;
  ownerEmail?: string | null;
  onClose: () => void;
}

export function ShareProjectModal({ initiativeId, ownerEmail, onClose }: ShareProjectModalProps) {
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
    api.getShares(initiativeId).then(setShares).catch(() => {}).finally(() => setLoading(false));
  }, [initiativeId]);

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
      const share = await api.createShare(initiativeId, email.trim(), role);
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
      const updated = await api.updateShare(initiativeId, shareId, newRole);
      setShares(prev => prev.map(s => s.id === shareId ? updated : s));
    } catch {
      setError('Failed to update role');
    }
  };

  const handleRemove = async (shareId: string) => {
    try {
      await api.deleteShare(initiativeId, shareId);
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
              <input
                ref={inputRef}
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleShare(); }}
                className="w-full h-9 px-3 text-xs rounded-lg bg-surface border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
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
            <div className="relative inline-flex shrink-0">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                className="h-9 appearance-none pl-3 pr-7 text-xs rounded-lg bg-surface border border-stroke-subtle text-text-primary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
            </div>
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
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-semibold text-accent">
                    {(ownerEmail || '?')[0].toUpperCase()}
                  </span>
                </div>
                <span className="text-xs text-text-primary truncate">{ownerEmail || 'You'}</span>
              </div>
              <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">Owner</span>
            </div>

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
                <div key={share.id} className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-surface-subtle flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-secondary">
                        {(share.user_email || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs text-text-primary truncate block">
                        {share.user_email || share.user_id}
                      </span>
                      {share.user_display_name && (
                        <span className="text-[10px] text-text-tertiary truncate block">
                          {share.user_display_name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="relative inline-flex">
                      <select
                        value={share.role}
                        onChange={(e) => handleRoleChange(share.id, e.target.value as 'editor' | 'viewer')}
                        className="h-6 appearance-none pl-2 pr-6 text-[10px] rounded bg-surface border border-stroke-subtle text-text-secondary focus:border-accent focus:outline-none cursor-pointer transition-colors"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary pointer-events-none" />
                    </div>
                    <button
                      onClick={() => handleRemove(share.id)}
                      className="p-1 rounded text-text-tertiary hover:text-indicator-orange transition-colors"
                      title="Remove access"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

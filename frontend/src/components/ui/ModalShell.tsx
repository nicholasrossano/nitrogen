'use client';

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Shared dim/blur behind any modal or interstitial. */
export const MODAL_BACKDROP_CLASS = 'bg-black/40 backdrop-blur-sm';

/**
 * Shared panel chrome for modals/interstitials — same shape, shadow weight, and
 * border thickness as the side nav bar and other floating chat-shell panels
 * (see CHAT_FLOATING_PANEL_CHROME in chatSidebarLayout.ts).
 */
export const MODAL_PANEL_CHROME = 'bg-surface rounded-2xl border border-stroke-subtle shadow-floating-panel';

interface ModalShellProps {
  onClose: () => void;
  /** Tailwind max-width class for the panel, e.g. 'max-w-sm', 'max-w-2xl'. Default: 'max-w-md' */
  maxWidth?: string;
  /** Extra classes applied to the panel (e.g. 'flex flex-col max-h-[80vh]') */
  className?: string;
  children: React.ReactNode;
}

/**
 * Reusable modal shell — frosted backdrop + floating-panel depth matching the side nav.
 * Handles portal mounting, Escape key, and click-outside-to-close.
 */
export function ModalShell({ onClose, maxWidth = 'max-w-md', className = '', children }: ModalShellProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
    [onClose],
  );

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center ${MODAL_BACKDROP_CLASS}`}
      onClick={handleBackdropClick}
    >
      <div
        className={`relative w-full ${maxWidth} mx-4 ${MODAL_PANEL_CHROME} overflow-hidden animate-fade-in ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

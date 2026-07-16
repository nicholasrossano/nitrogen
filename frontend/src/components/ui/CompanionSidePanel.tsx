'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { widgetHeaderIconButtonClassName } from '@/components/editor/EditorPanelHeader';
import { COMPANION_SIDE_PANEL_WIDTH_PX } from '@/components/ui/chatSidebarLayout';

/** Shared width for assessment deep-dive / activity-log companion columns. */
export const COMPANION_SIDE_PANEL_WIDTH = COMPANION_SIDE_PANEL_WIDTH_PX;

interface CompanionSidePanelProps {
  title: string;
  eyebrow?: string;
  leading?: ReactNode;
  headerAccessory?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

/**
 * Right-hand companion column used inside assessment (and reusable by floats).
 * Same chrome as the deep-dive inspector: border, slide-in, Escape to close.
 */
export function CompanionSidePanel({
  title,
  eyebrow,
  leading,
  headerAccessory,
  onClose,
  children,
  ariaLabel,
}: CompanionSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      className="w-full h-full flex-shrink-0 bg-white border-l border-divider flex flex-col outline-none"
      style={{ animation: 'slideInRight 0.2s ease-out forwards' }}
    >
      <div className="flex items-start gap-3 pl-5 pr-3 py-4 border-b border-stroke-subtle flex-shrink-0">
        {leading}
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <span className="text-[11px] text-text-tertiary font-medium uppercase tracking-wide">
              {eyebrow}
            </span>
          )}
          <h2 className={`text-sm font-semibold text-text-primary leading-snug ${eyebrow ? 'mt-0.5' : ''}`}>
            {title}
          </h2>
        </div>
        {headerAccessory}
        <button
          type="button"
          onClick={onClose}
          className={widgetHeaderIconButtonClassName()}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}

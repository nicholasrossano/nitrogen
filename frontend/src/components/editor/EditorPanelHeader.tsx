'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface EditorPanelHeaderProps {
  title: string;
  suffix?: string | null;
  onClose?: () => void;
  actions?: ReactNode;
}

export function EditorPanelHeader({
  title,
  suffix,
  onClose,
  actions,
}: EditorPanelHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-divider bg-white px-3 py-2.5">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close editor"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stroke-subtle text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
        <span>{title}</span>
        {suffix ? (
          <span className="text-text-tertiary">
            {' '}
            ·
            {suffix}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function EditorPanelHeaderIconButton({
  label,
  onClick,
  disabled = false,
  children,
  className = '',
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-md border border-stroke-subtle text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      {children}
    </button>
  );
}

'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type WidgetHeaderIconButtonOptions = {
  size?: 'sm' | 'md';
  bordered?: boolean;
};

/** Shared hit target styles for widget/panel header icon buttons (close, collapse, etc.). */
export function widgetHeaderIconButtonClassName(
  options: WidgetHeaderIconButtonOptions = {},
): string {
  const { size = 'md', bordered = false } = options;
  const dimension = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8';
  const border = bordered ? 'border border-stroke-subtle' : '';
  const tone = bordered
    ? 'text-text-secondary hover:text-text-primary'
    : 'text-text-tertiary hover:text-text-secondary';

  return [
    'flex shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors',
    'hover:bg-black/[0.06] active:bg-black/[0.09]',
    bordered ? 'hover:border-text-tertiary/30' : '',
    dimension,
    border,
    tone,
  ].filter(Boolean).join(' ');
}

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
          className={widgetHeaderIconButtonClassName({ bordered: true })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
        <span>{title}</span>
        {suffix ? (
          <span className="text-text-tertiary">
            {' '}
            •
            {' '}
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
      className={`${widgetHeaderIconButtonClassName({ bordered: true })} disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      {children}
    </button>
  );
}

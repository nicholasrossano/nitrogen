'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface ChatPanelWidgetShellProps {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  collapsed?: boolean;
  layoutMode?: 'inline' | 'panel';
  onCollapsedChange?: (collapsed: boolean) => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}

export function ChatPanelWidgetShell({
  icon,
  eyebrow,
  title,
  collapsed = false,
  layoutMode = 'inline',
  onCollapsedChange,
  onClose,
  headerActions,
  bodyClassName,
  children,
}: ChatPanelWidgetShellProps) {
  const isPanelLayout = layoutMode === 'panel' && !collapsed;
  const defaultBodyClassName = isPanelLayout
    ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-36 pt-3'
    : 'max-h-64 overflow-y-auto overflow-x-hidden px-4 pb-3';

  return (
    <div
      className={
        isPanelLayout
          ? 'flex h-full min-h-0 flex-col bg-surface-subtle/40'
          : 'border-b border-divider bg-surface-subtle/40'
      }
    >
      <div
        className={
          isPanelLayout
            ? 'flex items-center gap-2.5 border-b border-divider px-4 py-2.5'
            : 'flex items-center gap-2.5 px-4 py-2.5'
        }
      >
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-accent/10">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-medium uppercase tracking-wide leading-none text-text-tertiary">
            {eyebrow}
          </span>
          <p className="truncate text-xs font-semibold leading-snug text-text-primary">
            {title}
          </p>
        </div>
        {headerActions}
        {onCollapsedChange ? (
          <button
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
            aria-label="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div className={bodyClassName ?? defaultBodyClassName}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

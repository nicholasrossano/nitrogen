'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Loader2, Pencil, X } from 'lucide-react';
import { SHELL_SURFACE_HEADER_CLASS } from '@/components/ui/chatSidebarLayout';

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
  titleEditable?: boolean;
  onSaveTitle?: (title: string) => void | Promise<void>;
  titleSaving?: boolean;
  suffix?: string | null;
  /** Dismiss the panel / float layer. Always rendered on the right when provided. */
  onClose?: () => void;
  /** Optional one-level-up navigation. Rendered on the left when provided. */
  onBack?: () => void;
  actions?: ReactNode;
}

function EditablePanelTitle({
  title,
  titleEditable = false,
  onSaveTitle,
  titleSaving = false,
  suffix,
}: {
  title: string;
  titleEditable?: boolean;
  onSaveTitle?: (title: string) => void | Promise<void>;
  titleSaving?: boolean;
  suffix?: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(title);
    setIsEditing(false);
  }, [title]);

  useEffect(() => {
    if (!isEditing || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [isEditing]);

  const handleSave = async () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(title);
      setIsEditing(false);
      return;
    }
    await onSaveTitle?.(trimmed);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraftTitle(title);
    setIsEditing(false);
  };

  if (isEditing && titleEditable) {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            } else if (e.key === 'Escape') {
              handleCancel();
            }
          }}
          style={{ width: `${Math.max(draftTitle.length + 2, 10)}ch` }}
          className="no-global-focus-style min-w-0 max-w-full truncate px-0 py-0.5 text-sm font-medium text-text-primary bg-transparent border-0 border-b border-accent rounded-none shadow-none focus:outline-none focus:ring-0 focus:shadow-none"
          disabled={titleSaving}
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={titleSaving}
          className="icon-btn icon-btn-success p-1 text-indicator-green flex-shrink-0"
          aria-label="Save name"
        >
          {titleSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={titleSaving}
          className="icon-btn p-1 text-text-tertiary flex-shrink-0"
          aria-label="Cancel rename"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5 group">
      <span className="min-w-0 truncate">{title}</span>
      {suffix ? (
        <span className="shrink-0 whitespace-nowrap text-text-tertiary">
          {' • '}
          {suffix}
        </span>
      ) : null}
      {titleEditable ? (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="icon-btn p-1 opacity-0 group-hover:opacity-100 text-text-tertiary flex-shrink-0"
          aria-label="Rename"
        >
          <Pencil className="w-3 h-3" />
        </button>
      ) : null}
    </div>
  );
}

export function EditorPanelHeader({
  title,
  titleEditable = false,
  onSaveTitle,
  titleSaving = false,
  suffix,
  onClose,
  onBack,
  actions,
}: EditorPanelHeaderProps) {
  return (
    <header className={`${SHELL_SURFACE_HEADER_CLASS} gap-2.5 border-b border-divider bg-white px-3`}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className={widgetHeaderIconButtonClassName({ bordered: true })}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 overflow-hidden text-sm font-medium text-text-primary">
        <EditablePanelTitle
          title={title}
          titleEditable={titleEditable}
          onSaveTitle={onSaveTitle}
          titleSaving={titleSaving}
          suffix={suffix}
        />
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      ) : null}
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

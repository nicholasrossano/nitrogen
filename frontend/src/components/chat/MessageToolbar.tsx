'use client';

import { useState, useCallback } from 'react';
import { Copy, Pencil, ThumbsUp, ThumbsDown, RefreshCw, Check } from 'lucide-react';

interface ToolbarIconProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  spinning?: boolean;
}

function ToolbarIcon({ icon, label, onClick, active = false, disabled = false, spinning = false }: ToolbarIconProps) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        'p-1 rounded transition-colors',
        active
          ? 'text-accent'
          : 'text-text-tertiary hover:text-text-primary',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        spinning ? 'animate-spin' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
    </button>
  );
}

interface UserMessageToolbarProps {
  content: string;
  onEdit: () => void;
  hideEdit?: boolean;
}

export function UserMessageToolbar({ content, onEdit, hideEdit = false }: UserMessageToolbarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable
    }
  }, [content]);

  return (
    <div className="flex items-center gap-0.5 relative">
      {copied && (
        <span className="absolute -top-6 right-0 text-xs text-text-secondary bg-surface-subtle border border-stroke-subtle rounded px-1.5 py-0.5 whitespace-nowrap pointer-events-none">
          Copied
        </span>
      )}
      <ToolbarIcon
        icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        label="Copy message"
        onClick={handleCopy}
        active={copied}
      />
      {!hideEdit && (
        <ToolbarIcon
          icon={<Pencil className="w-3.5 h-3.5" />}
          label="Edit message"
          onClick={onEdit}
        />
      )}
    </div>
  );
}

interface AssistantMessageToolbarProps {
  content: string;
  feedback: 'like' | 'dislike' | null;
  onFeedback: (f: 'like' | 'dislike' | null) => void;
  onRetry: () => void;
  retrying: boolean;
  hideRetry?: boolean;
}

export function AssistantMessageToolbar({
  content,
  feedback,
  onFeedback,
  onRetry,
  retrying,
  hideRetry = false,
}: AssistantMessageToolbarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable
    }
  }, [content]);

  const handleLike = useCallback(() => {
    onFeedback(feedback === 'like' ? null : 'like');
  }, [feedback, onFeedback]);

  const handleDislike = useCallback(() => {
    onFeedback(feedback === 'dislike' ? null : 'dislike');
  }, [feedback, onFeedback]);

  return (
    <div className="flex items-center gap-0.5 relative">
      {copied && (
        <span className="absolute -top-6 left-0 text-xs text-text-secondary bg-surface-subtle border border-stroke-subtle rounded px-1.5 py-0.5 whitespace-nowrap pointer-events-none">
          Copied
        </span>
      )}
      <ToolbarIcon
        icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        label="Copy response"
        onClick={handleCopy}
        active={copied}
      />

      {/* Like — hidden when dislike is active */}
      {feedback !== 'dislike' && (
        <button
          title={feedback === 'like' ? 'Remove helpful rating' : 'Helpful'}
          aria-label={feedback === 'like' ? 'Remove helpful rating' : 'Helpful'}
          onClick={handleLike}
          className="p-1 rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-primary"
        >
          <ThumbsUp
            className="w-3.5 h-3.5"
            {...(feedback === 'like' ? { style: { fill: 'currentColor', strokeWidth: 0 } } : {})}
          />
        </button>
      )}

      {/* Dislike — hidden when like is active */}
      {feedback !== 'like' && (
        <button
          title={feedback === 'dislike' ? 'Remove unhelpful rating' : 'Not helpful'}
          aria-label={feedback === 'dislike' ? 'Remove unhelpful rating' : 'Not helpful'}
          onClick={handleDislike}
          className="p-1 rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-primary"
        >
          <ThumbsDown
            className="w-3.5 h-3.5"
            {...(feedback === 'dislike' ? { style: { fill: 'currentColor', strokeWidth: 0 } } : {})}
          />
        </button>
      )}

      {!hideRetry && (
        <ToolbarIcon
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          label={retrying ? 'Retrying…' : 'Retry'}
          onClick={onRetry}
          disabled={retrying}
          spinning={retrying}
        />
      )}
    </div>
  );
}

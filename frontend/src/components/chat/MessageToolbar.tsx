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
}

export function UserMessageToolbar({ content, onEdit }: UserMessageToolbarProps) {
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
      <ToolbarIcon
        icon={<Pencil className="w-3.5 h-3.5" />}
        label="Edit message"
        onClick={onEdit}
      />
    </div>
  );
}

interface AssistantMessageToolbarProps {
  content: string;
  feedback: 'like' | 'dislike' | null;
  onFeedback: (f: 'like' | 'dislike' | null) => void;
  onRetry: () => void;
  retrying: boolean;
}

export function AssistantMessageToolbar({
  content,
  feedback,
  onFeedback,
  onRetry,
  retrying,
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
      <ToolbarIcon
        icon={<ThumbsUp className="w-3.5 h-3.5" />}
        label="Helpful"
        onClick={handleLike}
        active={feedback === 'like'}
      />
      <ToolbarIcon
        icon={<ThumbsDown className="w-3.5 h-3.5" />}
        label="Not helpful"
        onClick={handleDislike}
        active={feedback === 'dislike'}
      />
      <ToolbarIcon
        icon={<RefreshCw className="w-3.5 h-3.5" />}
        label={retrying ? 'Retrying…' : 'Retry'}
        onClick={onRetry}
        disabled={retrying}
        spinning={retrying}
      />
    </div>
  );
}

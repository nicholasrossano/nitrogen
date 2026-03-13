'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, Loader2, MessageSquare, Trash2, Paperclip, X } from 'lucide-react';
import type { ChatSession } from '@/stores/chatStore';
import { ALL_TOOLS } from '@/components/chat/ToolPicker';


interface LandingInputProps {
  onSend: (content: string, toolHint?: string) => void;
  onUploadFile?: (file: File) => Promise<void>;
  disabled?: boolean;
  sessions?: ChatSession[];
  onLoadSession?: (session: ChatSession) => void;
  onDeleteSession?: (id: string) => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function LandingInput({ onSend, onUploadFile, disabled, sessions = [], onLoadSession, onDeleteSession }: LandingInputProps) {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHistoryScroll = useCallback(() => {
    setIsScrolling(true);
    if (scrollHideTimer.current) clearTimeout(scrollHideTimer.current);
    scrollHideTimer.current = setTimeout(() => setIsScrolling(false), 1000);
  }, []);


  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const ro = new ResizeObserver(() => adjustHeight());
    ro.observe(textarea);
    return () => ro.disconnect();
  }, [adjustHeight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled || uploading) return;

    if (attachedFiles.length > 0 && onUploadFile) {
      setUploading(true);
      for (const file of attachedFiles) {
        try {
          await onUploadFile(file);
        } catch (err) {
          console.error('Failed to upload attachment:', file.name, err);
        }
      }
      setUploading(false);
    }

    onSend(input.trim());
    setInput('');
    setAttachedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setAttachedFiles((prev) => [...prev, ...files]);
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col items-center h-full px-4">
      <div className="flex-1 flex flex-col justify-end items-center w-full max-w-2xl">
        <div className="w-[70%] grid grid-cols-3 gap-2 mb-12">
          {ALL_TOOLS.map((tool) => {
            const isTemplate = tool.id === 'template_fill';
            return (
              <button
                key={tool.id}
                type="button"
                disabled={disabled}
                onClick={() => onSend(`Generate ${tool.name}`, tool.id)}
                className={`relative flex flex-col items-center justify-center gap-1.5 px-2 h-[72px] rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-default ${
                  isTemplate
                    ? 'border-2 border-dashed border-accent-secondary/30 bg-accent-secondary/[0.05] hover:border-accent-secondary/50 hover:bg-accent-secondary/[0.09]'
                    : 'border border-accent/15 bg-accent/[0.04] hover:border-accent/40 hover:bg-accent/[0.08]'
                }`}
              >
                {(tool.id === 'gs_certification' || tool.id === 'pdd' || isTemplate) && (
                  <span className="absolute top-1.5 right-1.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-indicator-yellow/10 text-indicator-yellow leading-none">
                    BETA
                  </span>
                )}
                <span className={`[&>svg]:w-4.5 [&>svg]:h-4.5 ${isTemplate ? 'text-accent-secondary/70' : 'text-accent/70'}`}>{tool.icon}</span>
                <span className="text-[11px] font-medium text-text-secondary leading-snug text-center">{tool.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full max-w-2xl">
        <form onSubmit={handleSubmit} className="relative">
          <div
            className="rounded-[10px] border border-stroke-subtle bg-white overflow-hidden"
          >
            {attachedFiles.length > 0 && (
              <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5">
                {attachedFiles.map((file, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-subtle border border-stroke-subtle text-[11px] font-medium text-text-secondary leading-none max-w-[160px]"
                  >
                    <Paperclip className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(i)}
                      className="hover:opacity-60 transition-opacity shrink-0"
                      aria-label="Remove file"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                }}
                onFocus={() => {
                  setFocused(true);
                }}
                onBlur={() => setFocused(false)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything"
                disabled={disabled}
                rows={1}
                className="w-full resize-none bg-transparent px-5 py-3.5 pb-8 pr-5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:bg-surface-subtle disabled:text-text-tertiary overflow-hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              />
              {/* Bottom-right: attach + send */}
              <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5 pointer-events-none [&>*]:pointer-events-auto">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  aria-label="Attach files"
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 text-text-tertiary enabled:hover:text-text-secondary disabled:opacity-40 disabled:cursor-default"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-[13px] h-[13px]" />
                </button>
                <button
                  type="submit"
                  disabled={disabled || uploading || !input.trim()}
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent"
                >
                  {uploading ? (
                    <Loader2 className="w-[11px] h-[11px] text-white animate-spin" />
                  ) : (
                    <ArrowUp className="w-[11px] h-[11px] text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div className="flex-1 min-h-0 w-full max-w-2xl flex flex-col">
        {sessions.length > 0 && (
          <div className="mt-12 flex flex-col min-h-0 flex-1">
            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 px-1">
              History
            </p>
            <div
              ref={historyListRef}
              onScroll={handleHistoryScroll}
              className={`space-y-1 overflow-y-auto flex-1 min-h-0 pr-1 [&::-webkit-scrollbar-thumb]:transition-colors [&::-webkit-scrollbar-thumb]:duration-300 ${isScrolling ? '[&::-webkit-scrollbar-thumb]:bg-divider' : '[&::-webkit-scrollbar-thumb]:bg-transparent'}`}
            >
              {sessions.map((session) => (
                <HistoryRow
                  key={session.id}
                  session={session}
                  onOpen={() => onLoadSession?.(session)}
                  onDelete={() => onDeleteSession?.(session.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  session,
  onOpen,
  onDelete,
}: {
  session: ChatSession;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-subtle transition-colors duration-100 cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      <MessageSquare className="w-4 h-4 text-text-tertiary shrink-0" />
      <span className="flex-1 text-sm text-text-secondary truncate">
        {session.title}
      </span>
      <span className="text-xs text-text-tertiary shrink-0 tabular-nums">
        {relativeTime(session.createdAt)}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`shrink-0 p-0.5 rounded transition-all duration-100 text-text-tertiary hover:text-red-400 ${
          hovered ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="Delete conversation"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, MessageSquare, Trash2, Paperclip, X } from 'lucide-react';
import { useChatStore, ChatSession } from '@/stores/chatStore';
import { ToolPicker, ToolChip, type ToolOption } from '@/components/chat/ToolPicker';

const EXAMPLE_PROMPTS = [
  'What MECS standards apply to clean cooking programs?',
  'Design a compliance framework for off-grid solar in Kenya',
  'Compare carbon credit methodologies for cookstove projects',
  'What MRV requirements exist for clean energy in Sub-Saharan Africa?',
  'Outline environmental safeguards for a mini-grid project',
  'What are the Gold Standard certification steps for a biogas program?',
];

interface LandingInputProps {
  onSend: (content: string, toolHint?: string) => void;
  disabled?: boolean;
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

export function LandingInput({ onSend, disabled }: LandingInputProps) {
  const [input, setInput] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [animating, setAnimating] = useState(true);
  const [focused, setFocused] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolOption | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReducedMotion = useRef(false);

  const { sessions, loadSession, deleteSession } = useChatStore();

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }, []);

  const stopAnimation = useCallback(() => {
    setAnimating(false);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setPlaceholder('Ask anything');
  }, []);

  useEffect(() => {
    if (!animating) return;
    if (prefersReducedMotion.current) {
      setPlaceholder(EXAMPLE_PROMPTS[0]);
      return;
    }

    let promptIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let paused = false;

    function tick() {
      if (!animating) return;
      const prompt = EXAMPLE_PROMPTS[promptIdx];

      if (paused) return;

      if (!deleting) {
        charIdx++;
        setPlaceholder(prompt.slice(0, charIdx));
        if (charIdx === prompt.length) {
          paused = true;
          timeoutRef.current = setTimeout(() => {
            paused = false;
            deleting = true;
            tick();
          }, 2000);
          return;
        }
      } else {
        charIdx--;
        setPlaceholder(prompt.slice(0, charIdx));
        if (charIdx === 0) {
          deleting = false;
          promptIdx = (promptIdx + 1) % EXAMPLE_PROMPTS.length;
        }
      }

      const speed = deleting ? 20 : 45;
      timeoutRef.current = setTimeout(tick, speed);
    }

    tick();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [animating]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const toolHint = selectedTool?.id ?? undefined;
    onSend(input.trim(), toolHint);
    setInput('');
    setAttachedFiles([]);
    setSelectedTool(null);
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
    <div className="flex flex-col items-center justify-center flex-1 px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-display font-semibold text-text-primary mb-8 text-center">
          Let&apos;s build a better world.
        </h1>

        <form onSubmit={handleSubmit} className="relative">
          <div
            className="rounded-[10px] border border-stroke-subtle bg-white overflow-hidden"
            style={{ boxShadow: '0 10px 28px -6px rgba(0,0,0,0.14), 0 4px 10px -3px rgba(0,0,0,0.09)' }}
          >
            {(attachedFiles.length > 0 || selectedTool) && (
              <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5">
                {selectedTool && (
                  <ToolChip tool={selectedTool} onRemove={() => setSelectedTool(null)} />
                )}
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
                  if (animating) stopAnimation();
                }}
                onFocus={() => {
                  setFocused(true);
                  if (animating) stopAnimation();
                }}
                onBlur={() => setFocused(false)}
                onKeyDown={handleKeyDown}
                placeholder={focused ? '' : placeholder}
                disabled={disabled}
                rows={1}
                className="w-full resize-none bg-transparent px-5 py-3.5 pb-8 pr-5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:bg-surface-subtle disabled:text-text-tertiary overflow-hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              />
              {/* Bottom-left: tool picker */}
              <div className="absolute left-3 bottom-2.5 pointer-events-none [&>*]:pointer-events-auto">
                <ToolPicker
                  selected={selectedTool}
                  onSelect={setSelectedTool}
                  disabled={disabled}
                  mode="standalone"
                />
              </div>
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
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 text-text-tertiary hover:text-text-secondary disabled:opacity-40 disabled:cursor-default"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-[13px] h-[13px]" />
                </button>
                <button
                  type="submit"
                  disabled={disabled || !input.trim()}
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent"
                >
                  <ArrowUp className="w-[11px] h-[11px] text-white" />
                </button>
              </div>
            </div>
          </div>
        </form>

        {sessions.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 px-1">
              History
            </p>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto pr-1">
              {sessions.map((session) => (
                <HistoryRow
                  key={session.id}
                  session={session}
                  onOpen={() => loadSession(session)}
                  onDelete={() => deleteSession(session.id)}
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

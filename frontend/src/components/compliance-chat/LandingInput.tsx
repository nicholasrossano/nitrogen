'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, MessageSquare, Trash2 } from 'lucide-react';
import { useChatStore, ChatSession } from '@/stores/chatStore';

const EXAMPLE_PROMPTS = [
  'What MECS standards apply to clean cooking programs?',
  'Design a compliance framework for off-grid solar in Kenya',
  'Compare carbon credit methodologies for cookstove projects',
  'What MRV requirements exist for clean energy in Sub-Saharan Africa?',
  'Outline environmental safeguards for a mini-grid project',
  'What are the Gold Standard certification steps for a biogas program?',
];

interface LandingInputProps {
  onSend: (content: string) => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    setPlaceholder('Ask about compliance, program design, standards...');
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
    onSend(input.trim());
    setInput('');
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
          Let's build a better world.
        </h1>

        <form onSubmit={handleSubmit} className="relative flex items-center">
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
            className="w-full resize-none rounded-[28px] border border-stroke-subtle bg-white px-5 py-3.5 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none disabled:bg-surface-subtle disabled:text-text-tertiary transition-colors duration-150 overflow-hidden"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          />
          <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none [&>*]:pointer-events-auto">
            <button
              type="submit"
              disabled={disabled || !input.trim()}
              className="flex items-center justify-center text-text-tertiary enabled:text-accent transition-colors duration-150 disabled:cursor-default"
            >
              <Send className="w-[18px] h-[18px]" />
            </button>
          </div>
        </form>

        {sessions.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 px-1">
              History
            </p>
            <div className="space-y-1">
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

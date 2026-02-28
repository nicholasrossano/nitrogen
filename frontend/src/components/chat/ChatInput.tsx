'use client';

import { useState, useRef, useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ArrowUp, X } from 'lucide-react';

interface ChatInputProps {
  initiativeId?: string;
  disabled?: boolean;
  stage?: string;
  placeholder?: string;
  onSend?: (content: string) => void;
}

export function ChatInput({ 
  initiativeId, 
  disabled = false, 
  stage,
  placeholder: customPlaceholder,
  onSend,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [draftTag, setDraftTag] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage } = useInitiativeStore();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const text = detail.text;
      const label = detail.label ?? null;
      if (text) {
        setInput(text);
        setDraftTag(label);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };
    window.addEventListener('nitrogen:draft', handler);
    return () => window.removeEventListener('nitrogen:draft', handler);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    const message = input.trim();
    setInput('');
    setDraftTag(null);
    
    if (onSend) {
      onSend(message);
    } else if (initiativeId) {
      await sendMessage(initiativeId, message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const placeholder = customPlaceholder || (
    stage === 'intake' ? "Describe your initiative..." :
    stage === 'evidence' ? "Upload documents above or ask a question..." :
    stage === 'generate' ? "Click Generate above or ask a question..." :
    "Ask a question..."
  );

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div
        className="rounded-[10px] border border-stroke-subtle bg-white overflow-hidden"
        style={{ boxShadow: '0 10px 28px -6px rgba(0,0,0,0.14), 0 4px 10px -3px rgba(0,0,0,0.09)' }}
      >
        {draftTag && (
          <div className="px-3 pt-2.5 pb-1 flex items-center">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
              {draftTag}
              <button
                type="button"
                onClick={() => { setDraftTag(null); setInput(''); }}
                className="hover:opacity-60 transition-opacity"
                aria-label="Remove"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          </div>
        )}
        <div className="relative flex items-center">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:text-text-tertiary overflow-hidden"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          />
          <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none [&>*]:pointer-events-auto">
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
  );
}

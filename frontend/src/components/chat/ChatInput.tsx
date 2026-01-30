'use client';

import { useState, useRef, useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Send, Loader2 } from 'lucide-react';

interface ChatInputProps {
  initiativeId: string;
  disabled: boolean;
  stage: string;
}

export function ChatInput({ initiativeId, disabled, stage }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage } = useInitiativeStore();

  // Auto-resize textarea
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
    await sendMessage(initiativeId, message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Show different placeholder based on stage
  const placeholder = 
    stage === 'intake' ? "Describe your initiative..." :
    stage === 'evidence' ? "Upload evidence above or ask a question..." :
    stage === 'generate' ? "Click Generate above or ask a question..." :
    "Ask a question about the memo...";

  return (
    <form onSubmit={handleSubmit} className="relative">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="w-full resize-none rounded-card border border-beige bg-cream px-4 py-3.5 pr-12 text-sm text-brown placeholder:text-brown/40 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 focus:outline-none disabled:bg-blush disabled:text-brown/50 transition-all duration-200 shadow-subtle overflow-hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-primary-600 text-white hover:bg-primary-700 disabled:bg-beige disabled:text-brown/30 disabled:cursor-not-allowed transition-all duration-200"
      >
        {disabled ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
      </button>
    </form>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Send } from 'lucide-react';

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

  // Show different placeholder based on stage
  const placeholder = customPlaceholder || (
    stage === 'intake' ? "Describe your initiative..." :
    stage === 'evidence' ? "Upload documents above or ask a question..." :
    stage === 'generate' ? "Click Generate above or ask a question..." :
    "Ask a question..."
  );

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="w-full resize-none rounded-none border border-stroke-subtle bg-white px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none disabled:bg-surface-subtle disabled:text-text-tertiary transition-colors duration-150 overflow-hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      />
      <div className="absolute right-2 top-0 bottom-0 flex items-center py-2 pointer-events-none [&>*]:pointer-events-auto">
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="btn-filled h-full max-h-full aspect-square min-h-[1.75rem] rounded-full flex items-center justify-center p-1.5 bg-accent text-white disabled:bg-stroke-subtle disabled:text-text-tertiary disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4 flex-shrink-0" />
        </button>
      </div>
    </form>
  );
}

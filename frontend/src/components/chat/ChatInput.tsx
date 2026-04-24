'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import type { FieldContext } from '@/lib/api';
import { ArrowUp, X, Paperclip } from 'lucide-react';
import { debugChatFlow } from '@/lib/chatDebug';

interface ChatInputProps {
  initiativeId?: string;
  disabled?: boolean;
  stage?: string;
  placeholder?: string;
  onSend?: (content: string, fieldContext?: FieldContext | null, modelInputsContext?: string | null) => void;
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
  const [draftFieldContext, setDraftFieldContext] = useState<FieldContext | null>(null);
  const [draftModelInputsContext, setDraftModelInputsContext] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sendMessage } = useInitiativeStore();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        text?: string;
        label?: string | null;
        fieldContext?: FieldContext | null;
        modelInputsContext?: string | null;
      } | null;
      const text = detail?.text;
      const label = detail?.label ?? null;
      if (text) {
        setInput(text);
        setDraftTag(label);
        setDraftFieldContext(detail?.fieldContext ?? null);
        setDraftModelInputsContext(detail?.modelInputsContext ?? null);
        debugChatFlow('draft-received', {
          surface: 'chat-input',
          field_name: detail?.fieldContext?.field_name ?? null,
          model_type: detail?.fieldContext?.model_type ?? null,
          has_field_context: Boolean(detail?.fieldContext),
          has_model_inputs_context: Boolean(detail?.modelInputsContext),
        });
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };
    window.addEventListener('nitrogen:draft', handler);
    return () => window.removeEventListener('nitrogen:draft', handler);
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

  // Re-measure when container resizes (e.g. after client-side nav when layout settles)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const ro = new ResizeObserver(() => adjustHeight());
    ro.observe(textarea);
    return () => ro.disconnect();
  }, [adjustHeight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    const message = input.trim();
    setInput('');
    setDraftTag(null);
    setDraftFieldContext(null);
    setDraftModelInputsContext(null);
    setAttachedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    if (onSend) {
      debugChatFlow('composer-send', {
        surface: 'chat-input',
        field_name: draftFieldContext?.field_name ?? null,
        model_type: draftFieldContext?.model_type ?? null,
        has_field_context: Boolean(draftFieldContext),
        has_model_inputs_context: Boolean(draftModelInputsContext),
      });
      onSend(message, draftFieldContext, draftModelInputsContext);
    } else if (initiativeId) {
      await sendMessage(initiativeId, message, undefined, draftFieldContext);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...files]);
    }
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
      >
        {draftTag && (
          <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
              {draftTag}
              <button
                type="button"
                onClick={() => { setDraftTag(null); setDraftFieldContext(null); setInput(''); }}
                className="hover:opacity-60 transition-opacity"
                aria-label="Remove"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="px-3 pt-2.5 pb-1 flex flex-wrap gap-1.5">
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

        <textarea
          ref={textareaRef}
          value={input.replace(/\n?\[TEMPLATE_CONTEXT\][\s\S]*?\[\/TEMPLATE_CONTEXT\]/g, '')}
          onChange={(e) => {
            const ctx = input.match(/\n?\[TEMPLATE_CONTEXT\][\s\S]*?\[\/TEMPLATE_CONTEXT\]/)?.[0] || '';
            setInput(ctx ? e.target.value + ctx : e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:text-text-tertiary overflow-hidden"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        />

        {/* Bottom row: attach + send */}
        <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5">
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
            disabled={disabled || !input.trim()}
            className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent"
          >
            <ArrowUp className="w-[11px] h-[11px] text-white" />
          </button>
        </div>
      </div>
    </form>
  );
}

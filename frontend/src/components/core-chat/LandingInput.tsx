'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, Loader2, MessageSquare, Trash2, Paperclip, X } from 'lucide-react';
import type { ChatSession } from '@/types/chat';
import type { MessageAttachment } from '@/lib/api';
import { ALL_MODULES } from '@/components/chat/AssessmentPicker';
import { TourAnchor } from '@/components/tour/TourAnchor';
import { ChatTrialHint } from '@/components/ui/ChatTrialHint';
import { UploadToast } from '@/components/ui/UploadToast';
import { useComposerAttachments } from '@/hooks/useComposerAttachments';
import { useVisibleAssessments } from '@/hooks/useFeatureFlag';
import { useIsMobile } from '@/hooks/useIsMobile';


interface LandingInputProps {
  onSend: (content: string, toolHint?: string, attachments?: MessageAttachment[]) => void;
  onUploadFile?: (file: File) => Promise<MessageAttachment | null>;
  disabled?: boolean;
  /** Keep send disabled even when the field has text (e.g. demo mode) */
  sendDisabled?: boolean;
  sessions?: ChatSession[];
  onLoadSession?: (session: ChatSession) => void;
  onDeleteSession?: (id: string) => void;
  /** Hide the tool tile grid (e.g. in compare mode) */
  hideTiles?: boolean;
  /** Custom content rendered above the input field (below the tiles area) */
  headerContent?: React.ReactNode;
  /** Action cluster pinned to the overview panel chrome */
  topRightActions?: React.ReactNode;
  /** Override the default placeholder text */
  placeholder?: string;
  /** Extra action buttons rendered in the composer toolbar (before paperclip) */
  extraInputActions?: React.ReactNode;
  /** Controls rendered on the right side of the composer toolbar (before attach/send) */
  trailingInputActions?: React.ReactNode;
  /** Chips rendered above the textarea (e.g. compare project chip) */
  inputChips?: React.ReactNode;
  /** Large title rendered above the composer (left-aligned) */
  composerTitle?: string | null;
  /** Attached tray rendered above and visually connected to the composer */
  topComposerContent?: React.ReactNode;
  /** Content rendered below the composer (e.g. project outputs on chat landing) */
  belowComposerContent?: React.ReactNode;
  /** Alternate landing layout for initiative overview pages */
  layoutMode?: 'default' | 'overview';
  /** Hide composer input area (used when side chat is active) */
  hideComposer?: boolean;
  /** Show file attachment controls in the composer */
  showAttachments?: boolean;
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

export function LandingInput({
  onSend,
  onUploadFile,
  disabled,
  sendDisabled = false,
  sessions = [],
  onLoadSession,
  onDeleteSession,
  hideTiles,
  headerContent,
  topRightActions,
  placeholder = 'Ask anything',
  extraInputActions,
  trailingInputActions,
  inputChips,
  composerTitle,
  topComposerContent,
  belowComposerContent,
  layoutMode = 'default',
  hideComposer = false,
  showAttachments = true,
}: LandingInputProps) {
  const isMobile = useIsMobile();
  const visibleAssessments = useVisibleAssessments(ALL_MODULES);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const {
    attachedFiles,
    addFiles,
    removeFile: removeAttachedFile,
    uploading,
    uploadAndCollect,
    toastItems,
    showToast,
    dismissToast,
  } = useComposerAttachments();
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
    if (!input.trim() || disabled || sendDisabled || uploading) return;

    let attachments: MessageAttachment[] = [];
    if (attachedFiles.length > 0 && onUploadFile) {
      attachments = await uploadAndCollect(onUploadFile);
    }

    if (attachments.length > 0) {
      onSend(input.trim(), undefined, attachments);
    } else {
      onSend(input.trim());
    }
    setInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const contentMaxWidth = hideTiles ? 'max-w-3xl' : 'max-w-2xl';
  const showComposerTitle = Boolean(composerTitle?.trim());
  const hasBelowComposerContent = Boolean(belowComposerContent);
  const hiddenScrollbarClassName = 'overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';

  const renderComposerTitle = (className = 'mb-6 pl-6 text-left text-lg font-medium leading-tight tracking-tight text-text-primary sm:text-2xl') => (
    showComposerTitle ? (
      <h1 className={className}>
        {composerTitle}
      </h1>
    ) : null
  );

  const renderComposer = (containerClassName?: string) => {
    const hasTray = Boolean(topComposerContent);
    const shellClassName = hasTray ? 'chat-composer-shell chat-composer-shell--stacked' : 'chat-composer-shell';

    const shellContent = (
      <>
        {(inputChips || (showAttachments && attachedFiles.length > 0)) && (
          <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5">
            {inputChips}
            {showAttachments && attachedFiles.map((file, i) => (
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
              // iOS can leave a horizontal scroll offset after keyboard open.
              if (window.matchMedia('(max-width: 767px)').matches) {
                window.requestAnimationFrame(() => {
                  window.scrollTo({ left: 0, top: window.scrollY });
                });
              }
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="no-global-focus-style w-full resize-none bg-transparent px-5 py-3.5 pb-11 pr-5 text-base text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:bg-surface-subtle disabled:text-text-tertiary overflow-hidden md:text-sm max-md:min-w-0"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          />
          {extraInputActions && (
            <div className="absolute left-3 bottom-2.5 flex items-center gap-1.5 pointer-events-none [&>*]:pointer-events-auto">
              {extraInputActions}
            </div>
          )}
          <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5 pointer-events-none [&>*]:pointer-events-auto">
            {trailingInputActions}
            {showAttachments && (
              <>
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
                  className="relative flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-150 text-text-tertiary enabled:hover:text-text-secondary disabled:opacity-40 disabled:cursor-default max-md:h-4 max-md:w-4 max-md:before:absolute max-md:before:-inset-2.5 max-md:before:content-['']"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-[13px] h-[13px] max-md:h-3 max-md:w-3" />
                </button>
              </>
            )}
            <button
              type="submit"
              disabled={disabled || sendDisabled || uploading || !input.trim()}
              className="relative flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent max-md:h-4 max-md:w-4 max-md:before:absolute max-md:before:-inset-2.5 max-md:before:content-['']"
              aria-label="Send"
            >
              {uploading ? (
                <Loader2 className="w-[11px] h-[11px] text-white animate-spin max-md:h-2.5 max-md:w-2.5" />
              ) : (
                <ArrowUp className="w-[11px] h-[11px] text-white max-md:h-2.5 max-md:w-2.5" />
              )}
            </button>
          </div>
        </div>
      </>
    );

    return (
      <div className={containerClassName ?? `w-full ${contentMaxWidth}`}>
        <TourAnchor id="welcome-composer" as="div" className="w-full">
          {hasTray ? (
            <div className="chat-composer-stack">
              {topComposerContent}
              <form onSubmit={handleSubmit} className="relative">
                <div className={shellClassName}>{shellContent}</div>
              </form>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="relative">
              <div className={shellClassName}>{shellContent}</div>
            </form>
          )}
        </TourAnchor>
        <ChatTrialHint />
        {showToast && <UploadToast items={toastItems} onDismiss={dismissToast} />}
      </div>
    );
  };

  const renderHistory = (containerClassName?: string, compact = false) => (
    <div className={containerClassName ?? 'flex-1 min-h-0 w-full max-w-2xl flex flex-col'}>
      {sessions.length > 0 && (
        <div className={`${compact ? 'mt-2' : 'mt-12'} flex flex-col ${compact ? '' : 'min-h-0 flex-1'}`}>
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 px-1">
            History
          </p>
          <div
            ref={historyListRef}
            onScroll={handleHistoryScroll}
            className={`space-y-1 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:transition-colors [&::-webkit-scrollbar-thumb]:duration-300 ${compact ? 'h-36' : 'flex-1 min-h-0'} ${isScrolling ? '[&::-webkit-scrollbar-thumb]:bg-divider' : '[&::-webkit-scrollbar-thumb]:bg-transparent'}`}
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
  );

  if (layoutMode === 'overview') {
    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        {topRightActions ? (
          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            {topRightActions}
          </div>
        ) : null}
        <div className={`absolute inset-0 ${hiddenScrollbarClassName}`}>
          <div className={`px-4 pt-6 pb-8 ${topRightActions ? 'pr-44 sm:pr-52' : ''}`}>
            {headerContent}
            {!hideComposer ? (
              <div className={headerContent ? 'mt-6' : undefined}>
                {renderComposerTitle()}
                {renderComposer('w-full')}
              </div>
            ) : null}
            {hasBelowComposerContent ? (
              <div className="mt-6">
                {belowComposerContent}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Mobile-only stacked landing (2×2 context widgets under composer). Desktop keeps the prior layout.
  if (hasBelowComposerContent && isMobile) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-x-hidden px-4">
        <div className={`mx-auto flex h-full min-h-0 w-full min-w-0 flex-col ${contentMaxWidth}`}>
          {/* Sit title + composer between the prior mid-stage and top-third marks. */}
          <div className="flex h-[40%] shrink-0 flex-col justify-end pb-3 pt-2">
            {headerContent}
            {!hideTiles && (
              <div className="mb-4 grid w-full grid-cols-1 gap-3">
                {visibleAssessments.map((assessment) => (
                  <button
                    key={assessment.id}
                    type="button"
                    disabled={disabled || sendDisabled}
                    onClick={() => onSend(`Generate ${assessment.name}`, assessment.id)}
                    className="relative flex items-center gap-3 border border-black/[0.04] px-4 py-3.5 card-interactive disabled:cursor-default disabled:opacity-40"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-accent-wash">
                      <span className="text-accent [&>svg]:h-5 [&>svg]:w-5">{assessment.icon}</span>
                    </div>
                    <span className="text-left text-xs font-medium leading-snug text-text-secondary">
                      {assessment.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {renderComposerTitle('mb-3 min-w-0 truncate pl-6 pr-2 text-left text-lg font-medium leading-tight tracking-tight text-text-primary sm:mb-4 sm:text-2xl')}
            {renderComposer('min-w-0 w-full max-w-full')}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="min-h-0 flex-1">
              {belowComposerContent}
            </div>
            {sessions.length > 0 ? (
              <div className={`max-h-24 shrink-0 ${hiddenScrollbarClassName}`}>
                {renderHistory('w-full', true)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (hasBelowComposerContent) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center px-4">
        <div className={`flex-1 min-h-0 w-full ${hiddenScrollbarClassName}`}>
          <div className={`mx-auto w-full ${contentMaxWidth} pb-6 pt-28`}>
            {headerContent}
            {!hideTiles && (
              <div className="mb-12 grid w-[70%] grid-cols-3 gap-3">
                {visibleAssessments.map((assessment) => (
                  <button
                    key={assessment.id}
                    type="button"
                    disabled={disabled || sendDisabled}
                    onClick={() => onSend(`Generate ${assessment.name}`, assessment.id)}
                    className="relative flex items-center gap-3 border border-black/[0.04] px-4 py-3.5 card-interactive disabled:cursor-default disabled:opacity-40"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-accent-wash">
                      <span className="text-accent [&>svg]:h-5 [&>svg]:w-5">{assessment.icon}</span>
                    </div>
                    <span className="text-left text-xs font-medium leading-snug text-text-secondary">
                      {assessment.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {renderComposerTitle()}
            {renderComposer('w-full')}
            <div className="mt-6">
              {belowComposerContent}
            </div>
            {renderHistory(undefined, true)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center px-4 max-md:min-w-0 max-md:w-full max-md:max-w-full max-md:overflow-x-hidden">
      <div className={`flex flex-1 flex-col items-center justify-end w-full ${contentMaxWidth} max-md:min-w-0`}>
        {headerContent}
        {!hideTiles && (
        <div className="mb-12 grid w-[70%] grid-cols-3 gap-3 max-md:w-full max-md:grid-cols-1">
          {visibleAssessments.map((assessment) => {
            return (
              <button
                key={assessment.id}
                type="button"
                disabled={disabled || sendDisabled}
                onClick={() => onSend(`Generate ${assessment.name}`, assessment.id)}
                className="relative flex items-center gap-3 px-4 py-3.5 card-interactive border border-black/[0.04] disabled:opacity-40 disabled:cursor-default"
              >
                <div className="w-10 h-10 flex-shrink-0 rounded flex items-center justify-center bg-accent-wash">
                  <span className="[&>svg]:w-5 [&>svg]:h-5 text-accent">{assessment.icon}</span>
                </div>
                <span className="text-xs font-medium text-text-secondary leading-snug text-left">{assessment.name}</span>
              </button>
            );
          })}
        </div>
        )}
      </div>

      <div className={`relative w-full ${contentMaxWidth} max-md:min-w-0 max-md:max-w-full`}>
        {renderComposerTitle('absolute bottom-full left-0 mb-6 min-w-0 pl-6 text-left text-lg font-medium leading-tight tracking-tight text-text-primary sm:text-2xl max-md:right-0 max-md:truncate max-md:pr-2')}
        {renderComposer('w-full max-md:min-w-0 max-md:max-w-full')}
      </div>

      {renderHistory()}
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

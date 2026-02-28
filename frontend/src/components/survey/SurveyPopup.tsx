'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface SurveyOption {
  id: string;
  label: string;
}

export interface SurveyConfig {
  id: string;
  title: string;
  subtitle?: string;
  options: SurveyOption[];
  commentPlaceholder?: string;
}

export interface SurveyResponse {
  surveyId: string;
  selectedOption: string | null;
  comment: string;
  contextData?: Record<string, unknown>;
}

interface SurveyPopupProps {
  config: SurveyConfig;
  contextData?: Record<string, unknown>;
  onSubmit: (response: SurveyResponse) => void;
  onDismiss: () => void;
  countdownSeconds?: number;
}

const TICK_MS = 80;

export function SurveyPopup({
  config,
  contextData,
  onSubmit,
  onDismiss,
  countdownSeconds = 10,
}: SurveyPopupProps) {
  const totalDuration = countdownSeconds * 1000;
  const remainingRef = useRef(totalDuration);
  const lastTickRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [progress, setProgress] = useState(1);
  const [isEngaged, setIsEngaged] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [visible, setVisible] = useState(false);

  // Slide-up mount animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  const handleSubmit = useCallback(() => {
    onSubmit({
      surveyId: config.id,
      selectedOption,
      comment: comment.trim(),
      contextData,
    });
    setVisible(false);
    setTimeout(onDismiss, 200);
  }, [config.id, selectedOption, comment, contextData, onSubmit, onDismiss]);

  // Countdown — pauses while engaged
  useEffect(() => {
    if (isEngaged) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    lastTickRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const now = Date.now();
      remainingRef.current -= now - lastTickRef.current;
      lastTickRef.current = now;

      const next = Math.max(0, remainingRef.current / totalDuration);
      setProgress(next);

      if (remainingRef.current <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        handleDismiss();
      }
    }, TICK_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isEngaged, totalDuration, handleDismiss]);

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 w-[300px] bg-white border border-divider shadow-xl flex flex-col transition-all duration-200 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
      onMouseEnter={() => setIsEngaged(true)}
      onMouseLeave={() => setIsEngaged(false)}
      onFocusCapture={() => setIsEngaged(true)}
      onBlurCapture={() => setIsEngaged(false)}
      role="dialog"
      aria-label={config.title}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-divider">
        <div className="flex-1 pr-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5">
            Quick feedback
          </p>
          <p className="text-sm font-medium text-text-primary leading-snug">
            {config.title}
          </p>
          {config.subtitle && (
            <p className="text-xs text-text-tertiary mt-0.5 leading-snug">
              {config.subtitle}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Options */}
      <div className="px-4 pt-3 pb-2 space-y-1.5">
        {config.options.map((option) => (
          <button
            key={option.id}
            onClick={() =>
              setSelectedOption(option.id === selectedOption ? null : option.id)
            }
            className={`w-full text-left px-3 py-2 text-xs border transition-all duration-150 leading-snug ${
              selectedOption === option.id
                ? 'border-accent bg-accent-wash/40 text-text-primary font-medium'
                : 'border-stroke-subtle bg-white text-text-secondary hover:border-accent/50 hover:text-text-primary hover:bg-surface-subtle/50'
            }`}
          >
            <span className={`inline-block w-3 h-3 border mr-2 flex-shrink-0 align-middle transition-colors duration-150 ${
              selectedOption === option.id
                ? 'border-accent bg-accent'
                : 'border-stroke-subtle'
            }`} />
            {option.label}
          </button>
        ))}
      </div>

      {/* Comment box */}
      <div className="px-4 pb-3">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={config.commentPlaceholder ?? 'Add a note (optional)...'}
          rows={2}
          className="w-full text-xs border border-stroke-subtle bg-white text-text-primary placeholder:text-text-tertiary px-3 py-2 resize-none focus:outline-none focus:border-accent transition-colors duration-150 leading-relaxed"
        />
      </div>

      {/* Submit */}
      <div className="px-4 pb-4">
        <button
          onClick={handleSubmit}
          className="w-full btn-primary text-xs py-2"
        >
          Submit
        </button>
      </div>

      {/* Countdown bar — drains left to right */}
      <div className="h-[3px] bg-surface-subtle overflow-hidden">
        <div
          className="h-full bg-accent origin-left"
          style={{
            transform: `scaleX(${progress})`,
            transition: isEngaged ? 'none' : `transform ${TICK_MS}ms linear`,
          }}
        />
      </div>
    </div>
  );
}

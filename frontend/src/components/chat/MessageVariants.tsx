'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MessageVariantsProps {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function MessageVariants({ currentIndex, total, onPrev, onNext }: MessageVariantsProps) {
  if (total <= 1) return null;

  return (
    <div className="flex items-center gap-1 mt-1 text-xs text-text-tertiary select-none">
      <button
        onClick={onPrev}
        disabled={currentIndex === 0}
        aria-label="Previous response"
        className="p-0.5 rounded hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-3 h-3" />
      </button>
      <span>
        {currentIndex + 1} / {total}
      </span>
      <button
        onClick={onNext}
        disabled={currentIndex === total - 1}
        aria-label="Next response"
        className="p-0.5 rounded hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
}

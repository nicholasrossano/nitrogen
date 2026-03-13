'use client';

import { useEffect, useState } from 'react';
import { Sprout, TreeDeciduous } from 'lucide-react';

interface PageLoaderProps {
  /** Optional label shown below the icon. Defaults to "Loading…" */
  label?: string;
}

/**
 * Page-level loading indicator using the Sprout ↔ TreeDeciduous animation.
 * Use for full-page or full-panel loading states only.
 * Do NOT use for inline or thought-chain loading — use Loader2 there.
 */
export function PageLoader({ label = 'Loading…' }: PageLoaderProps) {
  const [showSprout, setShowSprout] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setShowSprout((p) => !p), 750);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-1.5">
      <div className="relative w-10 h-10">
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
            showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <Sprout className="w-6 h-6 text-accent" strokeWidth={1.5} />
        </div>
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
            !showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <TreeDeciduous className="w-6 h-6 text-accent" strokeWidth={1.5} />
        </div>
      </div>
      {label && (
        <span className="text-xs text-text-secondary font-medium tracking-wide">{label}</span>
      )}
    </div>
  );
}

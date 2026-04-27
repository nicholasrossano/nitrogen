'use client';

import { useEffect, useState } from 'react';
import { Sprout, TreeDeciduous } from 'lucide-react';

import { LoadingArtHost } from './loading-art';
import { useSettingsStore } from '@/stores/settingsStore';

interface UniversalLoadingIconProps {
  size?: number;
  colorClassName?: string;
  className?: string;
}

interface PageLoaderProps {
  /** Optional label shown below the icon. Defaults to "Loading…" */
  label?: string;
  /** Compact icon by default; use art for longer generation/research waits. */
  variant?: 'icon' | 'art';
  /** Pixel size for the icon or generated loading art. */
  size?: number;
  className?: string;
}

export function UniversalLoadingIcon({
  size = 40,
  colorClassName = 'text-accent',
  className = '',
}: UniversalLoadingIconProps) {
  const [showSprout, setShowSprout] = useState(true);
  const iconSize = Math.max(10, Math.round(size * 0.6));

  useEffect(() => {
    const interval = setInterval(() => setShowSprout((p) => !p), 750);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={['relative flex items-center justify-center', className].join(' ').trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div
        className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
          showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}
      >
        <Sprout
          className={colorClassName}
          style={{ width: iconSize, height: iconSize }}
          strokeWidth={1.5}
        />
      </div>
      <div
        className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
          !showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}
      >
        <TreeDeciduous
          className={colorClassName}
          style={{ width: iconSize, height: iconSize }}
          strokeWidth={1.5}
        />
      </div>
    </div>
  );
}

/**
 * Universal loading indicator. The compact icon is the default for most app loading states;
 * use the art variant for longer generation/research waits.
 */
export function PageLoader({
  label = 'Loading…',
  variant = 'icon',
  size,
  className = '',
}: PageLoaderProps) {
  const devMode = useSettingsStore((s) => s.devMode);
  const useArtVariant = variant === 'art' && devMode;
  const iconSize = variant === 'icon' ? (size ?? 40) : 40;

  if (useArtVariant) {
    return (
      <LoadingArtHost
        size={size ?? 240}
        label={label}
        className={['flex flex-col items-center justify-center gap-3', className].join(' ').trim()}
      />
    );
  }

  return (
    <div className={['flex flex-col items-center justify-center gap-1.5', className].join(' ').trim()}>
      <UniversalLoadingIcon size={iconSize} />
      {label && (
        <span className="text-xs text-text-secondary font-medium tracking-wide">{label}</span>
      )}
    </div>
  );
}

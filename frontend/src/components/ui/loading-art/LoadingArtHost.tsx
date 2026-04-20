'use client';

import { useMemo, useState } from 'react';

import { getLoadingArtById, getRandomLoadingArt } from './registry';

interface LoadingArtHostProps {
  artId?: string;
  size?: number;
  color?: string;
  label?: string;
  className?: string;
}

export function LoadingArtHost({
  artId,
  size = 240,
  color = 'var(--color-accent-anchor)',
  label = 'Loading…',
  className,
}: LoadingArtHostProps) {
  const [seedArtId] = useState(() => getRandomLoadingArt().id);

  const selectedArt = useMemo(
    () => getLoadingArtById(artId ?? seedArtId),
    [artId, seedArtId],
  );

  if (!selectedArt) return null;

  const ArtComponent = selectedArt.Component;

  return (
    <div className={className ?? 'flex flex-col items-center justify-center gap-3'}>
      <ArtComponent size={size} color={color} />
      {label ? (
        <span className="text-xs font-medium tracking-wide text-text-secondary">
          {label}
        </span>
      ) : null}
    </div>
  );
}

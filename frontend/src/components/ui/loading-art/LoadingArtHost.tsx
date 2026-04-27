'use client';

import { useMemo, useState } from 'react';

import { getLoadingArtById, getRandomLoadingArt } from './registry';

interface LoadingArtHostProps {
  artId?: string;
  size?: number;
  color?: string;
  className?: string;
}

export function LoadingArtHost({
  artId,
  size = 240,
  color = 'var(--color-accent-anchor)',
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
    </div>
  );
}

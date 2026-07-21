'use client';

import { useLayoutEffect, useState } from 'react';

/** Matches Tailwind `md` — mobile overrides apply only below this width. */
export const MOBILE_MAX_WIDTH_PX = 767;

const MOBILE_MQ = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;
const PORTRAIT_MQ = '(orientation: portrait)';

function subscribeMedia(query: string, onChange: (matches: boolean) => void): () => void {
  const mql = window.matchMedia(query);
  const handler = () => onChange(mql.matches);
  handler();
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

/**
 * SSR-safe viewport < 768px detector. Defaults to `false` on server and first
 * client paint so hydration matches desktop; updates in useLayoutEffect before paint.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useLayoutEffect(() => subscribeMedia(MOBILE_MQ, setIsMobile), []);

  return isMobile;
}

/**
 * True after the first client layout pass — use before applying desktop-only
 * restores that would flash the wrong chrome on mobile.
 */
export function useViewportResolved(): boolean {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => setReady(true), []);
  return ready;
}

/**
 * SSR-safe portrait orientation detector. Defaults to `false` until mount.
 */
export function useIsPortrait(): boolean {
  const [isPortrait, setIsPortrait] = useState(false);

  useLayoutEffect(() => subscribeMedia(PORTRAIT_MQ, setIsPortrait), []);

  return isPortrait;
}

'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface ZoomableContainerProps {
  children: ReactNode;
  className?: string;
  minScale?: number;
  maxScale?: number;
}

/**
 * Wraps content with trackpad pinch-to-zoom (ctrl+wheel).
 * Uses React state + CSS zoom so the browser handles the scroll area natively,
 * then useLayoutEffect to fix up the scroll position before paint.
 */
export function ZoomableContainer({
  children,
  className,
  minScale = 0.5,
  maxScale = 3,
}: ZoomableContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const zoomTarget = useRef({ cx: 0, cy: 0, vx: 0, vy: 0, padL: 0, padT: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;

      setScale(prev => {
        const cx = (el.scrollLeft + vx - padL) / prev;
        const cy = (el.scrollTop + vy - padT) / prev;
        zoomTarget.current = { cx, cy, vx, vy, padL, padT };

        const factor = Math.pow(2, -e.deltaY * 0.01);
        return Math.min(maxScale, Math.max(minScale, prev * factor));
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [minScale, maxScale]);

  // Synchronously adjust scroll position after React applies the new zoom,
  // but before the browser paints — keeps the cursor point stable.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || scale === 1) return;
    const { cx, cy, vx, vy, padL, padT } = zoomTarget.current;
    el.scrollLeft = cx * scale + padL - vx;
    el.scrollTop = cy * scale + padT - vy;
  }, [scale]);

  return (
    <div ref={scrollRef} className={className} style={{ overflow: 'auto' }}>
      <div style={{ zoom: scale }}>
        {children}
      </div>
    </div>
  );
}

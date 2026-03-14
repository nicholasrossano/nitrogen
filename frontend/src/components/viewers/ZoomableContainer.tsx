'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface ZoomableContainerProps {
  children: ReactNode;
  className?: string;
  minScale?: number;
  maxScale?: number;
}

/**
 * Wraps any content and adds trackpad pinch-to-zoom (ctrl+wheel).
 *
 * Uses CSS zoom applied imperatively (no React re-renders) so the
 * browser's own layout engine handles the scrollable-area calculation.
 * Scroll position is adjusted each frame to keep the cursor point stable.
 */
export function ZoomableContainer({
  children,
  className,
  minScale = 0.5,
  maxScale = 3,
}: ZoomableContainerProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const content = contentRef.current;
    if (!outer || !content) return;

    let scale = 1;

    const padL = parseFloat(getComputedStyle(outer).paddingLeft) || 0;
    const padT = parseFloat(getComputedStyle(outer).paddingTop) || 0;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const rect = outer.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;

      // Content coordinate under cursor (unscaled)
      const cx = (outer.scrollLeft + vx - padL) / scale;
      const cy = (outer.scrollTop + vy - padT) / scale;

      // Multiplicative scaling — smooth for both trackpad and mouse wheel
      const factor = Math.pow(2, -e.deltaY * 0.01);
      scale = Math.min(maxScale, Math.max(minScale, scale * factor));

      content.style.zoom = String(scale);

      // Adjust scroll so the point under the cursor stays put
      outer.scrollLeft = cx * scale + padL - vx;
      outer.scrollTop = cy * scale + padT - vy;
    };

    outer.addEventListener('wheel', onWheel, { passive: false });
    return () => outer.removeEventListener('wheel', onWheel);
  }, [minScale, maxScale]);

  return (
    <div ref={outerRef} className={className} style={{ overflow: 'auto' }}>
      <div ref={contentRef}>
        {children}
      </div>
    </div>
  );
}

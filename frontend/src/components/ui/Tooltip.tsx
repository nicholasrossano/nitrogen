'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_WIDTH = 200;
const EDGE_PAD = 8;
const GAP = 6;

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  /** Extra classes applied to the trigger wrapper span */
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0, width: TOOLTIP_WIDTH });
  const [mounted, setMounted] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const handleMouseEnter = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
    setStyle({ opacity: 0, width: TOOLTIP_WIDTH });
    setVisible(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
  };

  // Position above the cursor, clamped to viewport
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current || !cursor) return;

    const tip = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipH = tip.height;

    let left = cursor.x - TOOLTIP_WIDTH / 2;
    left = Math.max(EDGE_PAD, Math.min(left, vw - TOOLTIP_WIDTH - EDGE_PAD));

    let top: number;
    if (cursor.y - tipH - GAP >= EDGE_PAD) {
      top = cursor.y - tipH - GAP;
    } else if (vh - cursor.y - GAP >= tipH + EDGE_PAD) {
      top = cursor.y + GAP;
    } else {
      top = Math.max(EDGE_PAD, cursor.y - tipH - GAP);
    }

    setStyle({ opacity: 1, width: TOOLTIP_WIDTH, left, top });
  }, [visible, cursor, content]);

  return (
    <>
      <span
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setVisible(false)}
        className={className}
      >
        {children}
      </span>

      {mounted && visible && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className="pointer-events-none fixed z-[9999] px-3 py-2 bg-white rounded-lg shadow-lg border border-gray-100 text-[11px] text-gray-600 leading-relaxed"
          style={style}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}

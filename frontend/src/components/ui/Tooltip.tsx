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
  /** When true, tooltip width matches content instead of fixed width */
  fitContent?: boolean;
  /** Delay before showing the tooltip (ms) */
  showDelayMs?: number;
}

export function Tooltip({
  content,
  children,
  className,
  fitContent = false,
  showDelayMs = 0,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>(
    fitContent ? { opacity: 0 } : { opacity: 0, width: TOOLTIP_WIDTH }
  );
  const [mounted, setMounted] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
    }
  }, []);

  const handleMouseEnter = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
    setStyle(fitContent ? { opacity: 0 } : { opacity: 0, width: TOOLTIP_WIDTH });
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (showDelayMs > 0) {
      showTimerRef.current = window.setTimeout(() => {
        setVisible(true);
        showTimerRef.current = null;
      }, showDelayMs);
      return;
    }
    setVisible(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
  };

  // Position above the cursor, clamped to viewport
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current || !cursor) return;

    const tip = tooltipRef.current.getBoundingClientRect();
    const tipWidth = fitContent ? tip.width : TOOLTIP_WIDTH;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipH = tip.height;

    let left = cursor.x - tipWidth / 2;
    left = Math.max(EDGE_PAD, Math.min(left, vw - tipWidth - EDGE_PAD));

    let top: number;
    if (cursor.y - tipH - GAP >= EDGE_PAD) {
      top = cursor.y - tipH - GAP;
    } else if (vh - cursor.y - GAP >= tipH + EDGE_PAD) {
      top = cursor.y + GAP;
    } else {
      top = Math.max(EDGE_PAD, cursor.y - tipH - GAP);
    }

    setStyle(fitContent ? { opacity: 1, left, top } : { opacity: 1, width: TOOLTIP_WIDTH, left, top });
  }, [visible, cursor, content, fitContent]);

  return (
    <>
      <span
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          if (showTimerRef.current != null) {
            window.clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
          }
          setVisible(false);
        }}
        className={className}
      >
        {children}
      </span>

      {mounted && visible && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`pointer-events-none fixed z-[9999] px-3 py-2 bg-white rounded-lg shadow-lg border border-gray-100 text-[11px] text-gray-600 leading-relaxed ${fitContent ? 'whitespace-nowrap' : ''}`}
          style={style}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}

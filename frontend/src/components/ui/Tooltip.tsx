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
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const handleMouseEnter = () => {
    // Reset to invisible before measuring so there's no flash at the wrong position
    setStyle({ opacity: 0, width: TOOLTIP_WIDTH });
    setVisible(true);
  };

  // After the tooltip renders (invisible), measure it and snap to the correct position
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current || !triggerRef.current) return;

    const trig = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: center on trigger, clamp so it never escapes the viewport
    let left = trig.left + trig.width / 2 - TOOLTIP_WIDTH / 2;
    left = Math.max(EDGE_PAD, Math.min(left, vw - TOOLTIP_WIDTH - EDGE_PAD));

    // Vertical: prefer above, flip below when there isn't enough room
    const tipH = tip.height;
    let top: number;
    if (trig.top - tipH - GAP >= EDGE_PAD) {
      top = trig.top - tipH - GAP;
    } else if (vh - trig.bottom - GAP >= tipH + EDGE_PAD) {
      top = trig.bottom + GAP;
    } else {
      // Best effort: clamp so it stays on screen
      top = Math.max(EDGE_PAD, trig.top - tipH - GAP);
    }

    setStyle({ opacity: 1, width: TOOLTIP_WIDTH, left, top });
  }, [visible, content]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
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

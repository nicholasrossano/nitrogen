'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { registerTourAnchor, unregisterTourAnchor } from '@/components/tour/tourRegistry';

interface TourAnchorProps {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Use a block wrapper when the child is a block-level control. */
  as?: 'span' | 'div';
  /**
   * `floor` = expanded Overview/Variables/Files panel header.
   * Mount-triggered tips only start for floor surfaces so sidebar nav
   * wrappers with the same id do not fire prematurely.
   */
  surface?: 'floor';
}

/**
 * Marks a DOM target for the product tour. Registration is sync on mount
 * and cleaned up on unmount — no layout animation.
 */
export function TourAnchor({
  id,
  children,
  className,
  style,
  as = 'span',
  surface,
}: TourAnchorProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = as === 'div' ? divRef.current : spanRef.current;
    if (!el) return;
    registerTourAnchor(id, el);
    return () => unregisterTourAnchor(id, el);
  }, [as, id]);

  if (as === 'div') {
    return (
      <div
        ref={divRef}
        className={className}
        style={style}
        data-tour-id={id}
        data-tour-surface={surface}
      >
        {children}
      </div>
    );
  }

  return (
    <span
      ref={spanRef}
      className={className ?? 'inline-flex max-w-full'}
      style={style}
      data-tour-id={id}
      data-tour-surface={surface}
    >
      {children}
    </span>
  );
}

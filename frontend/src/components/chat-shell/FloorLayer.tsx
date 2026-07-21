'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader';
import { TourAnchor } from '@/components/tour/TourAnchor';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  CHAT_SIDEBAR_MARGIN,
  MOBILE_NAV_CHIP_HEADER_PADDING_LEFT,
} from '@/components/ui/chatSidebarLayout';
import {
  contextStackExpandOriginClass,
  contextStackExpandedPanelChromeClass,
  contextStackExpandedPanelMotionClass,
  contextStackPanelTransitionClass,
  type ChatContextExpandedWidget,
  type ContextPanelExpandMotion,
} from './chatContextStackMotion';

/** Opacity-only — a persistent `transform` (even scale-100) breaks nested scroll on iOS Safari. */
const MOBILE_FLOOR_MOTION_VISIBLE = 'opacity-100';
const MOBILE_FLOOR_MOTION_HIDDEN = 'opacity-0 pointer-events-none';

/**
 * Primary work surface you navigate into and back out of (Overview / Variables / Files / Assessments).
 * Chat is the default floor when no overlay FloorLayer is expanded (`expandedWidget == null`).
 * Desktop uses a back control; mobile uses a dismiss X on the right (nav chip occupies the left).
 */
interface FloorLayerProps {
  widget: ChatContextExpandedWidget;
  title: string;
  suffix?: string | null;
  visible: boolean;
  motionMode?: ContextPanelExpandMotion;
  onClose: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
  /** Fade the floating-card border/shadow out as the panel expands, so it settles as a flush floor. */
  flushOnExpand?: boolean;
  /** How far from the right edge the panel sits — shrinks to leave room for a companion FloatLayer. */
  rightInset?: string;
  /** Optional first-visit tour tip target (header chrome). */
  tourId?: string;
}

export function FloorLayer({
  widget,
  title,
  suffix,
  visible,
  motionMode = 'stack',
  onClose,
  headerActions,
  children,
  flushOnExpand = false,
  rightInset = '0.75rem',
  tourId,
}: FloorLayerProps) {
  const isMobile = useIsMobile();

  // Keep Safari from rubber-banding the page behind an open mobile floor.
  useEffect(() => {
    if (!isMobile || !visible) return;
    const root = document.documentElement;
    const prev = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'none';
    return () => {
      root.style.overscrollBehaviorY = prev;
    };
  }, [isMobile, visible]);

  const header = (
    <EditorPanelHeader
      title={title}
      // Project name is redundant on mobile floors (title alone is enough).
      suffix={isMobile ? null : suffix}
      // Mobile: X on the right (nav chip owns the left). Desktop: back control on the left.
      {...(isMobile ? { onClose } : { onBack: onClose })}
      actions={headerActions}
      // Clear the collapsed nav chip that overlays the floor's top-left on mobile.
      style={isMobile ? { paddingLeft: MOBILE_NAV_CHIP_HEADER_PADDING_LEFT } : undefined}
    />
  );

  const mobileStyle: CSSProperties | undefined = isMobile
    ? {
        width: `calc(100vw - (2 * ${CHAT_SIDEBAR_MARGIN}))`,
        height: `calc(100dvh - (2 * ${CHAT_SIDEBAR_MARGIN}))`,
      }
    : { right: rightInset };

  // Same flush-floor chrome as desktop — only the stage size / motion differ on mobile.
  const floorChromeClass = `rounded-2xl bg-surface border ${contextStackExpandedPanelChromeClass(visible, flushOnExpand)}`;

  return (
    <aside
      aria-hidden={!visible}
      style={mobileStyle}
      className={
        isMobile
          ? `absolute z-[90] left-3 top-3 flex min-h-0 flex-col overflow-hidden overscroll-none ${floorChromeClass} transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              visible ? MOBILE_FLOOR_MOTION_VISIBLE : MOBILE_FLOOR_MOTION_HIDDEN
            }`
          : `absolute z-30 inset-y-3 left-0 flex min-h-0 flex-col overflow-hidden ${floorChromeClass} ${contextStackExpandOriginClass(widget, motionMode)} ${contextStackPanelTransitionClass} ${contextStackExpandedPanelMotionClass(visible, motionMode)}`
      }
    >
      {tourId ? (
        <TourAnchor id={tourId} as="div" className="w-full shrink-0" surface="floor">
          {header}
        </TourAnchor>
      ) : (
        header
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface max-md:overscroll-y-contain max-md:[-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </aside>
  );
}

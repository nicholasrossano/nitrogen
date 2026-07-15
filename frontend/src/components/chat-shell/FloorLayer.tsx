'use client';

import type { ReactNode } from 'react';
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader';
import { TourAnchor } from '@/components/tour/TourAnchor';
import {
  contextStackExpandOriginClass,
  contextStackExpandedPanelChromeClass,
  contextStackExpandedPanelMotionClass,
  contextStackPanelTransitionClass,
  type ChatContextExpandedWidget,
  type ContextPanelExpandMotion,
} from './chatContextStackMotion';

/**
 * Primary work surface you navigate into and back out of (Overview / Variables / Files).
 * Chat is the default floor when no overlay FloorLayer is expanded (`expandedWidget == null`).
 * These use a back control (not dismiss X) because leaving them always returns to chat.
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
  const header = (
    <EditorPanelHeader
      title={title}
      suffix={suffix}
      onBack={onClose}
      actions={headerActions}
    />
  );

  return (
    <aside
      aria-hidden={!visible}
      style={{ right: rightInset }}
      className={`absolute z-30 inset-y-3 left-0 flex min-h-0 flex-col overflow-hidden rounded-2xl bg-surface border ${contextStackExpandedPanelChromeClass(visible, flushOnExpand)} ${contextStackExpandOriginClass(widget, motionMode)} ${contextStackPanelTransitionClass} ${contextStackExpandedPanelMotionClass(visible, motionMode)}`}
    >
      {tourId ? (
        <TourAnchor id={tourId} as="div" className="w-full shrink-0" surface="floor">
          {header}
        </TourAnchor>
      ) : (
        header
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
        {children}
      </div>
    </aside>
  );
}

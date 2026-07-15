'use client';

import type { ReactNode } from 'react';
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader';
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
  /** Show a back arrow instead of a close X (for a floor you navigate back out of). */
  backButton?: boolean;
  /** How far from the right edge the panel sits — shrinks to leave room for a companion FloatLayer. */
  rightInset?: string;
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
  backButton = false,
  rightInset = '0.75rem',
}: FloorLayerProps) {
  return (
    <aside
      aria-hidden={!visible}
      style={{ right: rightInset }}
      className={`absolute z-30 inset-y-3 left-0 flex min-h-0 flex-col overflow-hidden rounded-2xl bg-surface border ${contextStackExpandedPanelChromeClass(visible, flushOnExpand)} ${contextStackExpandOriginClass(widget, motionMode)} ${contextStackPanelTransitionClass} ${contextStackExpandedPanelMotionClass(visible, motionMode)}`}
    >
      <EditorPanelHeader
        title={title}
        suffix={suffix}
        onClose={onClose}
        actions={headerActions}
        backAction={backButton}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
        {children}
      </div>
    </aside>
  );
}

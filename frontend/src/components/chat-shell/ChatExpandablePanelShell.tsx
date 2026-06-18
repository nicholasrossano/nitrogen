'use client';

import type { ReactNode } from 'react';
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';
import {
  contextStackExpandOriginClass,
  contextStackExpandedPanelMotionClass,
  contextStackPanelTransitionClass,
  type ChatContextExpandedWidget,
} from './chatContextStackMotion';

interface ChatExpandablePanelShellProps {
  widget: ChatContextExpandedWidget;
  title: string;
  suffix?: string | null;
  visible: boolean;
  onClose: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
}

export function ChatExpandablePanelShell({
  widget,
  title,
  suffix,
  visible,
  onClose,
  headerActions,
  children,
}: ChatExpandablePanelShellProps) {
  return (
    <aside
      aria-hidden={!visible}
      className={`absolute z-30 inset-y-3 left-0 right-3 flex min-h-0 flex-col overflow-hidden ${CHAT_FLOATING_PANEL_CHROME} ${contextStackExpandOriginClass(widget)} ${contextStackPanelTransitionClass} ${contextStackExpandedPanelMotionClass(visible)}`}
    >
      <EditorPanelHeader
        title={title}
        suffix={suffix}
        onClose={onClose}
        actions={headerActions}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
        {children}
      </div>
    </aside>
  );
}

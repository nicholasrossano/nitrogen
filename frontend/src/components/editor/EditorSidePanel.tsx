'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LCOEOutputWidget } from '@/components/widgets/LCOEOutputWidget';
import { CarbonOutputWidget } from '@/components/widgets/CarbonOutputWidget';

export type RightPanelMode = 'closed' | 'project_plan' | 'editor';

export const EDITOR_WIDGET_TYPES = ['lcoe_output', 'carbon_output'] as const;

export interface EditorWidget {
  type: string;
  data: Record<string, any>;
  messageId: string;
}

interface EditorSidePanelProps {
  widgets: EditorWidget[];
  initiativeId?: string;
}

const WIDGET_LABELS: Record<string, string> = {
  lcoe_output: 'LCOE Model',
  carbon_output: 'Carbon Calculator',
};

export function EditorSidePanel({ widgets, initiativeId = '' }: EditorSidePanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const displayIndex = activeIndex ?? widgets.length - 1;
  const widget = widgets[displayIndex];

  if (!widget) return null;

  return (
    <div className="h-full flex flex-col bg-white" style={{ animation: 'slideInRight 0.2s ease-out forwards' }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-divider flex items-center gap-2">
        <h2 className="text-xs font-medium text-text-primary flex-1 truncate">
          {WIDGET_LABELS[widget.type] ?? 'Output'}
        </h2>
        {widgets.length > 1 && (
          <div className="flex items-center gap-1 text-text-tertiary">
            <button
              onClick={() => setActiveIndex(Math.max(0, displayIndex - 1))}
              disabled={displayIndex === 0}
              className="icon-btn p-0.5 disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] tabular-nums">
              {displayIndex + 1}/{widgets.length}
            </span>
            <button
              onClick={() => setActiveIndex(Math.min(widgets.length - 1, displayIndex + 1))}
              disabled={displayIndex === widgets.length - 1}
              className="icon-btn p-0.5 disabled:opacity-30"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Widget content */}
      <div className="flex-1 overflow-y-auto">
        <ErrorBoundary>
          <EditorWidgetRenderer
            type={widget.type}
            data={widget.data}
            initiativeId={initiativeId}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

function EditorWidgetRenderer({
  type,
  data,
  initiativeId,
}: {
  type: string;
  data: Record<string, any>;
  initiativeId: string;
}) {
  switch (type) {
    case 'lcoe_output':
      return <LCOEOutputWidget data={data} initiativeId={initiativeId} isActive />;
    case 'carbon_output':
      return <CarbonOutputWidget data={data} initiativeId={initiativeId} isActive />;
    default:
      return null;
  }
}

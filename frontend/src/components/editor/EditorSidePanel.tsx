'use client';

import { useState } from 'react';
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
      {/* Tab bar — only shown when there are multiple widgets */}
      {widgets.length > 1 && (
        <div className="flex-shrink-0 flex border-b border-divider bg-white overflow-x-auto">
          {widgets.map((w, i) => (
            <button
              key={w.messageId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setActiveIndex(i)}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                displayIndex === i
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {WIDGET_LABELS[w.type] ?? 'Output'}
            </button>
          ))}
        </div>
      )}

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

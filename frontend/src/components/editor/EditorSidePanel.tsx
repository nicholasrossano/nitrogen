'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { AlignmentNewMessage } from '@/components/widgets/AlignmentWidget';

const LCOEModelWidget = dynamic(() => import('@/components/widgets/LCOEModelWidget').then(m => ({ default: m.LCOEModelWidget })), { ssr: false });
const CarbonModelWidget = dynamic(() => import('@/components/widgets/CarbonModelWidget').then(m => ({ default: m.CarbonModelWidget })), { ssr: false });
const MemoViewerWidget = dynamic(() => import('@/components/widgets/MemoViewerWidget').then(m => ({ default: m.MemoViewerWidget })), { ssr: false });
const ChecklistViewerWidget = dynamic(() => import('@/components/widgets/ChecklistViewerWidget').then(m => ({ default: m.ChecklistViewerWidget })), { ssr: false });
const AlignmentWidget = dynamic(() => import('@/components/widgets/AlignmentWidget').then(m => ({ default: m.AlignmentWidget })), { ssr: false });
const DocumentViewerWidget = dynamic(() => import('@/components/widgets/DocumentViewerWidget').then(m => ({ default: m.DocumentViewerWidget })), { ssr: false });
const SolarEstimateWidget = dynamic(() => import('@/components/widgets/SolarEstimateWidget').then(m => ({ default: m.SolarEstimateWidget })), { ssr: false });
const ModuleWorkspace = dynamic(() => import('@/components/modules/ModuleWorkspace').then(m => ({ default: m.ModuleWorkspace })), { ssr: false });

export type RightPanelMode = 'closed' | 'project_plan' | 'editor';

export const EDITOR_WIDGET_TYPES = [
  'lcoe_inputs', 'lcoe_output',
  'carbon_inputs', 'carbon_output',
  'solar_inputs', 'solar_output',
  'memo_viewer',
  'checklist_viewer',
  'alignment',
  'document_viewer',
  'assessment_workspace',
  'module_workspace',
] as const;

export const WIDGET_MODEL_GROUP: Record<string, string> = {
  lcoe_inputs: 'lcoe',
  lcoe_output: 'lcoe',
  carbon_inputs: 'carbon',
  carbon_output: 'carbon',
  solar_inputs: 'solar',
  solar_output: 'solar',
  memo_viewer: 'memo',
  checklist_viewer: 'checklist',
  alignment: 'alignment',
  document_viewer: 'document_viewer',
  assessment_workspace: 'assessment',
  module_workspace: 'module',
};

export interface EditorWidget {
  type: string;
  data: Record<string, any>;
  messageId: string;
}

interface EditorSidePanelProps {
  widgets: EditorWidget[];
  initiativeId?: string;
  onAlignmentConfirmed?: (newMessages: AlignmentNewMessage[]) => void;
}

const WIDGET_LABELS: Record<string, string> = {
  lcoe_inputs: 'LCOE Model',
  lcoe_output: 'LCOE Model',
  carbon_inputs: 'Carbon Calculator',
  carbon_output: 'Carbon Calculator',
  solar_inputs: 'Solar Estimate',
  solar_output: 'Solar Estimate',
  memo_viewer: 'Investment Memo',
  checklist_viewer: 'Due Diligence',
  alignment: 'Memo Outline',
  document_viewer: 'Document',
  assessment_workspace: 'Assessment',
  module_workspace: 'Module',
};

export function EditorSidePanel({ widgets, initiativeId = '', onAlignmentConfirmed }: EditorSidePanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const displayIndex = activeIndex ?? widgets.length - 1;
  const widget = widgets[displayIndex];

  if (!widget) return null;

  return (
    <div className="h-full flex flex-col bg-white">
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

      <div className="flex-1 overflow-y-auto">
        <ErrorBoundary>
          <EditorWidgetRenderer
            key={widget.messageId}
            type={widget.type}
            data={widget.data}
            initiativeId={initiativeId}
            messageId={widget.messageId}
            onAlignmentConfirmed={onAlignmentConfirmed}
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
  messageId,
  onAlignmentConfirmed,
}: {
  type: string;
  data: Record<string, any>;
  initiativeId: string;
  messageId: string;
  onAlignmentConfirmed?: (newMessages: AlignmentNewMessage[]) => void;
}) {
  switch (type) {
    case 'lcoe_inputs':
    case 'lcoe_output':
      return <LCOEModelWidget data={data} initiativeId={initiativeId} messageId={messageId} isActive />;
    case 'carbon_inputs':
    case 'carbon_output':
      return <CarbonModelWidget data={data} initiativeId={initiativeId} messageId={messageId} isActive />;
    case 'solar_inputs':
    case 'solar_output':
      return <SolarEstimateWidget data={data} initiativeId={initiativeId} messageId={messageId} isActive />;
    case 'memo_viewer':
      return <MemoViewerWidget data={data} initiativeId={initiativeId} isActive />;
    case 'checklist_viewer':
      return <ChecklistViewerWidget data={data} initiativeId={initiativeId} isActive />;
    case 'alignment':
      return <AlignmentWidget data={data} initiativeId={initiativeId} isActive onConfirmed={onAlignmentConfirmed} />;
    case 'document_viewer':
      return <DocumentViewerWidget data={data} initiativeId={initiativeId} isActive />;
    case 'assessment_workspace':
    case 'module_workspace':
      return (
        <ModuleWorkspace
          instanceId={data.instance_id}
          moduleId={data.module_id}
          initiativeId={initiativeId}
        />
      );
    default:
      return null;
  }
}

'use client';

import { useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LCOEModelWidget } from '@/components/widgets/LCOEModelWidget';
import { CarbonModelWidget } from '@/components/widgets/CarbonModelWidget';
import { GSCertificationWidget } from '@/components/widgets/GSCertificationWidget';
import { MemoViewerWidget } from '@/components/widgets/MemoViewerWidget';
import { ChecklistViewerWidget } from '@/components/widgets/ChecklistViewerWidget';
import { AlignmentWidget } from '@/components/widgets/AlignmentWidget';
import type { AlignmentNewMessage } from '@/components/widgets/AlignmentWidget';
import { TemplateRequirementsWidget } from '@/components/widgets/TemplateRequirementsWidget';
import { TemplateViewerWidget } from '@/components/widgets/TemplateViewerWidget';
import { PDDWorkspaceWidget } from '@/components/widgets/PDDWorkspaceWidget';
import { DocumentViewerWidget } from '@/components/widgets/DocumentViewerWidget';
import { SolarEstimateWidget } from '@/components/widgets/SolarEstimateWidget';

export type RightPanelMode = 'closed' | 'project_plan' | 'editor';

export const EDITOR_WIDGET_TYPES = [
  'lcoe_inputs', 'lcoe_output',
  'carbon_inputs', 'carbon_output',
  'solar_inputs', 'solar_output',
  'gs_checklist', 'gs_cover_letter',
  'memo_viewer',
  'checklist_viewer',
  'alignment',
  'template_requirements',
  'template_viewer',
  'pdd_workspace',
  'document_viewer',
] as const;

export const WIDGET_MODEL_GROUP: Record<string, string> = {
  lcoe_inputs: 'lcoe',
  lcoe_output: 'lcoe',
  carbon_inputs: 'carbon',
  carbon_output: 'carbon',
  solar_inputs: 'solar',
  solar_output: 'solar',
  gs_checklist: 'gs',
  gs_cover_letter: 'gs',
  memo_viewer: 'memo',
  checklist_viewer: 'checklist',
  alignment: 'alignment',
  template_requirements: 'template',
  template_viewer: 'template',
  pdd_workspace: 'pdd',
  document_viewer: 'document_viewer',
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
  gs_checklist: 'GS Certification',
  gs_cover_letter: 'GS Certification',
  memo_viewer: 'Investment Memo',
  checklist_viewer: 'Due Diligence',
  alignment: 'Memo Outline',
  template_requirements: 'Template',
  template_viewer: 'Template Output',
  pdd_workspace: 'Project Design Document',
  document_viewer: 'Document',
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
    case 'gs_checklist':
    case 'gs_cover_letter':
      return <GSCertificationWidget data={data} initiativeId={initiativeId} messageId={messageId} />;
    case 'memo_viewer':
      return <MemoViewerWidget data={data} initiativeId={initiativeId} isActive />;
    case 'checklist_viewer':
      return <ChecklistViewerWidget data={data} initiativeId={initiativeId} isActive />;
    case 'alignment':
      return <AlignmentWidget data={data} initiativeId={initiativeId} isActive onConfirmed={onAlignmentConfirmed} />;
    case 'template_requirements':
      return <TemplateRequirementsWidget data={data} initiativeId={initiativeId} messageId={messageId} isActive />;
    case 'template_viewer':
      return <TemplateViewerWidget data={data} initiativeId={initiativeId} isActive />;
    case 'pdd_workspace':
      return <PDDWorkspaceWidget data={data} initiativeId={initiativeId} isActive />;
    case 'document_viewer':
      return <DocumentViewerWidget data={data} initiativeId={initiativeId} isActive />;
    default:
      return null;
  }
}

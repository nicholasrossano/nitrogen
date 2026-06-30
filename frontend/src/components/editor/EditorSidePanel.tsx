'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { EditorPanelHeader } from './EditorPanelHeader';
import {
  EditorPanelChromeProvider,
  type EditorPanelChrome,
} from './EditorPanelChromeContext';

const LCOEModelWidget = dynamic(() => import('@/components/widgets/LCOEModelWidget').then(m => ({ default: m.LCOEModelWidget })), { ssr: false });
const CarbonModelWidget = dynamic(() => import('@/components/widgets/CarbonModelWidget').then(m => ({ default: m.CarbonModelWidget })), { ssr: false });
const MemoViewerWidget = dynamic(() => import('@/components/widgets/MemoViewerWidget').then(m => ({ default: m.MemoViewerWidget })), { ssr: false });
const ChecklistViewerWidget = dynamic(() => import('@/components/widgets/ChecklistViewerWidget').then(m => ({ default: m.ChecklistViewerWidget })), { ssr: false });
const DocumentViewerWidget = dynamic(() => import('@/components/widgets/DocumentViewerWidget').then(m => ({ default: m.DocumentViewerWidget })), { ssr: false });
const SolarEstimateWidget = dynamic(() => import('@/components/widgets/SolarEstimateWidget').then(m => ({ default: m.SolarEstimateWidget })), { ssr: false });
const AssessmentWorkspace = dynamic(() => import('@/components/assessments/AssessmentWorkspace').then(m => ({ default: m.AssessmentWorkspace })), { ssr: false });

export const EDITOR_WIDGET_TYPES = [
  'lcoe_inputs', 'lcoe_output',
  'carbon_inputs', 'carbon_output',
  'solar_inputs', 'solar_output',
  'memo_viewer',
  'checklist_viewer',
  'document_viewer',
  'assessment_workspace',
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
  document_viewer: 'document_viewer',
  assessment_workspace: 'assessment',
};

export interface EditorWidget {
  type: string;
  data: Record<string, any>;
  messageId: string;
}

interface EditorSidePanelProps {
  widgets: EditorWidget[];
  projectId?: string;
  onClose?: () => void;
  onAssessmentEngaged?: (instanceId: string) => void;
  onOpenDecisionLog?: (context: { instanceId: string; assessmentId: string; title: string }) => void;
  onExportDecisionLog?: (context: { instanceId: string; assessmentId: string; title: string }) => void | Promise<void>;
}

function getWidgetTitle(widget: EditorWidget): string {
  const dataTitle = typeof widget.data?.title === 'string' ? widget.data.title.trim() : '';
  if (dataTitle) return dataTitle;
  const dataName = typeof widget.data?.name === 'string' ? widget.data.name.trim() : '';
  if (dataName) return dataName;
  const filename = typeof widget.data?.filename === 'string' ? widget.data.filename.trim() : '';
  if (filename) return filename;
  return WIDGET_LABELS[widget.type] ?? 'Output';
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
  document_viewer: 'Document',
  assessment_workspace: 'Assessment',
};

export function EditorSidePanel({
  widgets,
  projectId = '',
  onClose,
  onAssessmentEngaged,
  onOpenDecisionLog,
  onExportDecisionLog,
}: EditorSidePanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [childChrome, setChildChrome] = useState<EditorPanelChrome | null>(null);

  const handleChromeChange = useCallback((chrome: EditorPanelChrome | null) => {
    setChildChrome(chrome);
  }, []);

  const displayIndex = activeIndex ?? widgets.length - 1;
  const widget = widgets[displayIndex];

  useEffect(() => {
    setChildChrome(null);
  }, [widget?.messageId]);

  const headerTitle = childChrome?.title ?? (widget ? getWidgetTitle(widget) : 'Output');
  const headerSuffix = childChrome?.suffix;
  const headerActions = childChrome?.actions;

  if (!widget) return null;

  return (
    <div className="flex h-full flex-col bg-white">
      <EditorPanelHeader
        title={headerTitle}
        suffix={headerSuffix}
        onClose={onClose}
        actions={headerActions}
      />

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
              {getWidgetTitle(w)}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ErrorBoundary>
          <EditorPanelChromeProvider onChromeChange={handleChromeChange}>
            <EditorWidgetRenderer
              key={widget.messageId}
              type={widget.type}
              data={widget.data}
              projectId={projectId}
              messageId={widget.messageId}
              onAssessmentEngaged={onAssessmentEngaged}
              onOpenDecisionLog={onOpenDecisionLog}
              onExportDecisionLog={onExportDecisionLog}
            />
          </EditorPanelChromeProvider>
        </ErrorBoundary>
      </div>
    </div>
  );
}

function EditorWidgetRenderer({
  type,
  data,
  projectId,
  messageId,
  onAssessmentEngaged,
  onOpenDecisionLog,
  onExportDecisionLog,
}: {
  type: string;
  data: Record<string, any>;
  projectId: string;
  messageId: string;
  onAssessmentEngaged?: (instanceId: string) => void;
  onOpenDecisionLog?: (context: { instanceId: string; assessmentId: string; title: string }) => void;
  onExportDecisionLog?: (context: { instanceId: string; assessmentId: string; title: string }) => void | Promise<void>;
}) {
  switch (type) {
    case 'lcoe_inputs':
    case 'lcoe_output':
      return <LCOEModelWidget data={data} projectId={projectId} messageId={messageId} isActive />;
    case 'carbon_inputs':
    case 'carbon_output':
      return <CarbonModelWidget data={data} projectId={projectId} messageId={messageId} isActive />;
    case 'solar_inputs':
    case 'solar_output':
      return <SolarEstimateWidget data={data} projectId={projectId} messageId={messageId} isActive />;
    case 'memo_viewer':
      return <MemoViewerWidget data={data} projectId={projectId} isActive />;
    case 'checklist_viewer':
      return <ChecklistViewerWidget data={data} projectId={projectId} isActive />;
    case 'document_viewer':
      return <DocumentViewerWidget data={data} projectId={projectId} isActive />;
    case 'assessment_workspace':
      return (
        <AssessmentWorkspace
          instanceId={data.instance_id}
          assessmentId={data.assessment_id}
          assessmentTitle={data.title}
          projectId={projectId}
          usePanelHeader
          deferAgentStart={data.pending_engagement === true}
          onUserEngaged={() => onAssessmentEngaged?.(data.instance_id)}
          onOpenDecisionLog={onOpenDecisionLog}
          onExportDecisionLog={onExportDecisionLog}
        />
      );
    default:
      return null;
  }
}

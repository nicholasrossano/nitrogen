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
const VariableDetailWidget = dynamic(() => import('@/components/widgets/VariableDetailWidget').then(m => ({ default: m.VariableDetailWidget })), { ssr: false });
const DecisionLogWorkspaceTab = dynamic(() => import('@/components/decision-log/DecisionLogWorkspaceTab').then(m => ({ default: m.DecisionLogWorkspaceTab })), { ssr: false });
const AssessmentActivityLogTab = dynamic(() => import('@/components/core-chat/AssessmentActivityLogTab').then(m => ({ default: m.AssessmentActivityLogTab })), { ssr: false });

export const FLOAT_WIDGET_TYPES = [
  'lcoe_inputs', 'lcoe_output',
  'carbon_inputs', 'carbon_output',
  'solar_inputs', 'solar_output',
  'memo_viewer',
  'checklist_viewer',
  'document_viewer',
  'assessment_workspace',
  'variable_detail',
  'decision_log',
  'activity_log',
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
  variable_detail: 'variable_detail',
  decision_log: 'decision_log',
  activity_log: 'activity_log',
};

export interface FloatWidget {
  type: string;
  data: Record<string, any>;
  messageId: string;
}

export type AssessmentLogContext = {
  instanceId: string;
  assessmentId: string;
  title: string;
};

interface FloatLayerProps {
  widgets: FloatWidget[];
  projectId?: string;
  onClose?: () => void;
  onAssessmentEngaged?: (instanceId: string) => void;
  onOpenDecisionLog?: (context: AssessmentLogContext) => void;
  onOpenActivityLog?: (context: AssessmentLogContext) => void;
  onExportDecisionLog?: (context: AssessmentLogContext) => void | Promise<void>;
  onOpenAssessment?: (context: AssessmentLogContext) => void;
}

function getWidgetTitle(widget: FloatWidget): string {
  const dataTitle = typeof widget.data?.title === 'string' ? widget.data.title.trim() : '';
  if (dataTitle) return dataTitle;
  const dataName = typeof widget.data?.name === 'string' ? widget.data.name.trim() : '';
  if (dataName) return dataName;
  const filename = typeof widget.data?.filename === 'string' ? widget.data.filename.trim() : '';
  if (filename) return filename;
  return WIDGET_LABELS[widget.type] ?? 'Output';
}

/** Strip a `[Log] ` display prefix so back restores the module title cleanly. */
function stripLogTitlePrefix(title: string): string {
  return title.replace(/^\[Log\]\s*/i, '').trim();
}

/** Nested log widgets can navigate back to their parent assessment module. */
function getNestedLogBackContext(widget: FloatWidget | undefined): AssessmentLogContext | null {
  if (!widget || (widget.type !== 'activity_log' && widget.type !== 'decision_log')) {
    return null;
  }
  const instanceId = typeof widget.data?.instance_id === 'string' ? widget.data.instance_id : '';
  const assessmentId = typeof widget.data?.assessment_id === 'string' ? widget.data.assessment_id : '';
  if (!instanceId || !assessmentId) return null;
  const rawTitle = typeof widget.data?.title === 'string' ? widget.data.title : '';
  const title = stripLogTitlePrefix(rawTitle) || 'Assessment';
  return { instanceId, assessmentId, title };
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
  variable_detail: 'Variable',
  decision_log: 'Decision Log',
  activity_log: 'Activity Log',
};

export function FloatLayer({
  widgets,
  projectId = '',
  onClose,
  onAssessmentEngaged,
  onOpenDecisionLog,
  onOpenActivityLog,
  onExportDecisionLog,
  onOpenAssessment,
}: FloatLayerProps) {
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

  const nestedLogContext = getNestedLogBackContext(widget);
  const handleBack = nestedLogContext && onOpenAssessment
    ? () => onOpenAssessment(nestedLogContext)
    : undefined;

  if (!widget) return null;

  return (
    <div className="flex h-full flex-col bg-white">
      <EditorPanelHeader
        title={headerTitle}
        suffix={headerSuffix}
        onClose={onClose}
        onBack={handleBack}
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
            <FloatWidgetRenderer
              key={widget.messageId}
              type={widget.type}
              data={widget.data}
              projectId={projectId}
              messageId={widget.messageId}
              onAssessmentEngaged={onAssessmentEngaged}
              onOpenDecisionLog={onOpenDecisionLog}
              onOpenActivityLog={onOpenActivityLog}
              onExportDecisionLog={onExportDecisionLog}
              onOpenAssessment={onOpenAssessment}
            />
          </EditorPanelChromeProvider>
        </ErrorBoundary>
      </div>
    </div>
  );
}

function FloatWidgetRenderer({
  type,
  data,
  projectId,
  messageId,
  onAssessmentEngaged,
  onOpenDecisionLog,
  onOpenActivityLog,
  onExportDecisionLog,
  onOpenAssessment,
}: {
  type: string;
  data: Record<string, any>;
  projectId: string;
  messageId: string;
  onAssessmentEngaged?: (instanceId: string) => void;
  onOpenDecisionLog?: (context: AssessmentLogContext) => void;
  onOpenActivityLog?: (context: AssessmentLogContext) => void;
  onExportDecisionLog?: (context: AssessmentLogContext) => void | Promise<void>;
  onOpenAssessment?: (context: AssessmentLogContext) => void;
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
    case 'variable_detail':
      return <VariableDetailWidget data={data as { assumption: import('@/lib/api').Assumption }} />;
    case 'decision_log':
      return <DecisionLogWorkspaceTab assessmentInstanceId={data.instance_id} />;
    case 'activity_log':
      return (
        <AssessmentActivityLogTab
          instanceId={data.instance_id}
          assessmentId={data.assessment_id}
          assessmentTitle={typeof data.title === 'string' ? data.title : ''}
          onOpenModule={onOpenAssessment}
        />
      );
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
          onOpenActivityLog={onOpenActivityLog}
          onExportDecisionLog={onExportDecisionLog}
        />
      );
    default:
      return null;
  }
}

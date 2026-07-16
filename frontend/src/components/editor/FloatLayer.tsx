'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TourAnchor } from '@/components/tour/TourAnchor';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { Variable, ProjectMaterial } from '@/lib/api';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { EditorPanelHeader } from './EditorPanelHeader';
import {
  EditorPanelChromeProvider,
  type EditorPanelChrome,
} from './EditorPanelChromeContext';
import { assessmentHeaderTitle } from '@/lib/assessmentDisplay';

const LCOEModelWidget = dynamic(() => import('@/components/widgets/LCOEModelWidget').then(m => ({ default: m.LCOEModelWidget })), { ssr: false });
const CarbonModelWidget = dynamic(() => import('@/components/widgets/CarbonModelWidget').then(m => ({ default: m.CarbonModelWidget })), { ssr: false });
const MemoViewerWidget = dynamic(() => import('@/components/widgets/MemoViewerWidget').then(m => ({ default: m.MemoViewerWidget })), { ssr: false });
const ChecklistViewerWidget = dynamic(() => import('@/components/widgets/ChecklistViewerWidget').then(m => ({ default: m.ChecklistViewerWidget })), { ssr: false });
const DocumentViewerWidget = dynamic(() => import('@/components/widgets/DocumentViewerWidget').then(m => ({ default: m.DocumentViewerWidget })), { ssr: false });
const SolarEstimateWidget = dynamic(() => import('@/components/widgets/SolarEstimateWidget').then(m => ({ default: m.SolarEstimateWidget })), { ssr: false });
const AssessmentWorkspace = dynamic(() => import('@/components/assessments/AssessmentWorkspace').then(m => ({ default: m.AssessmentWorkspace })), { ssr: false });
const VariableDetailWidget = dynamic(() => import('@/components/widgets/VariableDetailWidget').then(m => ({ default: m.VariableDetailWidget })), { ssr: false });
const VariablesWorkspaceTab = dynamic(() => import('@/components/variables/VariablesWorkspaceTab').then(m => ({ default: m.VariablesWorkspaceTab })), { ssr: false });
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
  'variables_workspace',
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
  variables_workspace: 'variables',
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

export type AssessmentReportPayload = AssessmentLogContext & {
  material: ProjectMaterial;
};

interface FloatLayerProps {
  widgets: FloatWidget[];
  projectId?: string;
  onClose?: () => void;
  onAssessmentEngaged?: (instanceId: string) => void;
  onOpenDecisionLog?: (context: AssessmentLogContext) => void;
  onOpenActivityLog?: (context: AssessmentLogContext) => void;
  onExportDecisionLog?: (context: AssessmentLogContext) => void | Promise<void>;
  onOpenAssessmentReport?: (payload: AssessmentReportPayload) => void | Promise<void>;
  onOpenAssessment?: (context: AssessmentLogContext) => void;
  onAssessmentTitleChange?: (instanceId: string, title: string) => void;
  /** True while AssessmentWorkspace hosts a companion column (activity log / deep dive). */
  onCompanionSidePanelOpenChange?: (open: boolean) => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
  /** Persist selected variable id for the Variables workspace float (URL sync). */
  onVariablesSelectionChange?: (variableId: string | null) => void;
}

function getWidgetTitle(widget: FloatWidget): string {
  const dataTitle = typeof widget.data?.title === 'string' ? widget.data.title.trim() : '';
  if (dataTitle) {
    // Assessment list labels include " · @creator"; keep that out of the panel header.
    if (widget.type === 'assessment_workspace') {
      return assessmentHeaderTitle(dataTitle, 'Assessment');
    }
    return dataTitle;
  }
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

/** Nested log/report widgets can navigate back to their parent assessment module. */
function getNestedLogBackContext(widget: FloatWidget | undefined): AssessmentLogContext | null {
  if (
    !widget
    || (
      widget.type !== 'activity_log'
      && widget.type !== 'decision_log'
      && widget.type !== 'document_viewer'
    )
  ) {
    return null;
  }
  const instanceId = typeof widget.data?.instance_id === 'string' ? widget.data.instance_id : '';
  const assessmentId = typeof widget.data?.assessment_id === 'string' ? widget.data.assessment_id : '';
  if (!instanceId || !assessmentId) return null;
  const assessmentTitle = typeof widget.data?.assessment_title === 'string'
    ? widget.data.assessment_title
    : '';
  const rawTitle = assessmentTitle || (typeof widget.data?.title === 'string' ? widget.data.title : '');
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
  memo_viewer: 'memo',
  checklist_viewer: 'Due Diligence',
  document_viewer: 'Document',
  assessment_workspace: 'Assessment',
  variables_workspace: PROJECT_VARIABLES.title,
  variable_detail: PROJECT_VARIABLES.titleSingular,
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
  onOpenAssessmentReport,
  onOpenAssessment,
  onAssessmentTitleChange,
  onCompanionSidePanelOpenChange,
  onOpenDocument,
  onOpenFile,
  onVariablesSelectionChange,
}: FloatLayerProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [childChrome, setChildChrome] = useState<EditorPanelChrome | null>(null);

  const handleChromeChange = useCallback((chrome: EditorPanelChrome | null) => {
    // Bail when content is unchanged — register hook syncs every layout and would
    // otherwise setState forever on fresh chrome object identities.
    setChildChrome((prev) => {
      if (prev === chrome) return prev;
      if (prev == null || chrome == null) return chrome;
      if (
        prev.title === chrome.title
        && prev.titleEditable === chrome.titleEditable
        && prev.titleSaving === chrome.titleSaving
        && prev.suffix === chrome.suffix
        && prev.actions === chrome.actions
      ) {
        return prev;
      }
      return chrome;
    });
  }, []);

  const displayIndex =
    activeIndex != null && activeIndex < widgets.length
      ? activeIndex
      : Math.max(widgets.length - 1, 0);
  const widget = widgets[displayIndex];
  const widgetsIdentity = widgets.map((item) => item.messageId).join('|');

  useEffect(() => {
    setActiveIndex(null);
  }, [widgetsIdentity]);

  // Do not clear chrome on messageId change — the previous widget's unmount
  // cleanup already nulls it. Clearing after the new child's layout effect
  // drops Export/actions until the next state update.

  const headerTitle = childChrome?.title ?? (widget ? getWidgetTitle(widget) : 'Output');
  const headerSuffix = childChrome?.suffix;
  const headerActions = childChrome?.actions;
  const headerTitleEditable = childChrome?.titleEditable;
  const headerOnSaveTitle = childChrome?.onSaveTitle;
  const headerTitleSaving = childChrome?.titleSaving;

  const nestedLogContext = getNestedLogBackContext(widget);
  const handleBack = nestedLogContext && onOpenAssessment
    ? () => onOpenAssessment(nestedLogContext)
    : undefined;

  if (!widget) return null;

  const header = (
    <EditorPanelHeader
      title={headerTitle}
      titleEditable={headerTitleEditable}
      onSaveTitle={headerOnSaveTitle}
      titleSaving={headerTitleSaving}
      suffix={headerSuffix}
      onClose={onClose}
      onBack={handleBack}
      actions={headerActions}
    />
  );

  return (
    <div className="flex h-full flex-col bg-white">
      {widget.type === 'variables_workspace' ? (
        <TourAnchor id="feature-variables" as="div" className="w-full shrink-0" surface="floor">
          {header}
        </TourAnchor>
      ) : (
        header
      )}

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

      <div className={`flex-1 min-h-0 ${widget.type === 'variables_workspace' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <ErrorBoundary>
          <EditorPanelChromeProvider onChromeChange={handleChromeChange}>
            <FloatWidgetRenderer
              key={widget.messageId}
              type={widget.type}
              data={widget.data}
              projectId={projectId}
              messageId={widget.messageId}
              onClose={onClose}
              onAssessmentEngaged={onAssessmentEngaged}
              onOpenDecisionLog={onOpenDecisionLog}
              onOpenActivityLog={onOpenActivityLog}
              onExportDecisionLog={onExportDecisionLog}
              onOpenAssessmentReport={onOpenAssessmentReport}
              onOpenAssessment={onOpenAssessment}
              onAssessmentTitleChange={onAssessmentTitleChange}
              onCompanionSidePanelOpenChange={onCompanionSidePanelOpenChange}
              onOpenDocument={onOpenDocument}
              onOpenFile={onOpenFile}
              onVariablesSelectionChange={onVariablesSelectionChange}
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
  onClose,
  onAssessmentEngaged,
  onOpenDecisionLog,
  onOpenActivityLog,
  onExportDecisionLog,
  onOpenAssessmentReport,
  onOpenAssessment,
  onAssessmentTitleChange,
  onCompanionSidePanelOpenChange,
  onOpenDocument,
  onOpenFile,
  onVariablesSelectionChange,
}: {
  type: string;
  data: Record<string, any>;
  projectId: string;
  messageId: string;
  onClose?: () => void;
  onAssessmentEngaged?: (instanceId: string) => void;
  onOpenDecisionLog?: (context: AssessmentLogContext) => void;
  onOpenActivityLog?: (context: AssessmentLogContext) => void;
  onExportDecisionLog?: (context: AssessmentLogContext) => void | Promise<void>;
  onOpenAssessmentReport?: (payload: AssessmentReportPayload) => void | Promise<void>;
  onOpenAssessment?: (context: AssessmentLogContext) => void;
  onAssessmentTitleChange?: (instanceId: string, title: string) => void;
  onCompanionSidePanelOpenChange?: (open: boolean) => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
  onVariablesSelectionChange?: (variableId: string | null) => void;
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
    case 'variables_workspace':
      return (
        <VariablesWorkspaceTab
          projectId={projectId}
          embedded
          showDetailPanel
          focusVariableId={
            typeof data.focus_variable_id === 'string' ? data.focus_variable_id : (typeof data.focus_assumption_id === 'string' ? data.focus_assumption_id : null)
          }
          onSelectedVariableIdChange={onVariablesSelectionChange}
          onOpenDocument={onOpenDocument}
          onOpenFile={onOpenFile}
          onCompanionSidePanelOpenChange={onCompanionSidePanelOpenChange}
        />
      );
    case 'variable_detail':
      return <VariableDetailWidget data={data as { variable?: Variable; assumption?: Variable }} onClose={onClose} />;
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
          onOpenAssessmentReport={onOpenAssessmentReport}
          onTitleChange={(title) => onAssessmentTitleChange?.(data.instance_id, title)}
          onCompanionSidePanelOpenChange={onCompanionSidePanelOpenChange}
        />
      );
    default:
      return null;
  }
}

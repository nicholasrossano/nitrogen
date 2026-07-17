'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { ProjectContextPanel } from '@/components/chat-shell/ProjectContextPanel';
import { ProjectVariablesPanel } from '@/components/chat-shell/ProjectVariablesPanel';
import { ProjectAssessmentsPanel } from '@/components/chat-shell/ProjectAssessmentsPanel';
import { ProjectFilesPanel } from '@/components/chat-shell/ProjectFilesPanel';
import { FloorLayer } from '@/components/chat-shell/FloorLayer';
import {
  contextStackTransitionClass,
  contextStackWidgetMotionClass,
  CONTEXT_STACK_MOTION_MS,
  type ChatContextExpandedWidget,
  type ContextPanelExpandMotion,
  type ExpandedWidgetChangeOptions,
} from '@/components/chat-shell/chatContextStackMotion';
import { CHAT_CONTEXT_STACK_WIDTH } from '@/components/ui/chatSidebarLayout';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { projectDisplayName } from '@/lib/projectDisplayName';
import { api, type AssessmentInstance, type Project, type ProjectMaterial, type Variable, type WorkspaceKnowledgeBank } from '@/lib/api';
import { useProjectStore } from '@/stores/projectStore';
import { ProjectOverviewExpandedPanel } from '@/components/chat-shell/ProjectOverviewExpandedPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { FilesScopeToggle, type FilesScope } from '@/components/files';
import { TourAnchor } from '@/components/tour/TourAnchor';
import { FrameworkPlanView } from '@/components/framework/FrameworkPlanView';

export type { ChatContextExpandedWidget, ExpandedWidgetChangeOptions };

const VariablesWorkspaceTab = dynamic(
  () => import('@/components/variables/VariablesWorkspaceTab').then((m) => m.VariablesWorkspaceTab),
  { ssr: false },
);

const ProjectFilesView = dynamic(
  () => import('@/components/files').then((m) => m.ProjectFilesView),
  { ssr: false },
);

export interface ChatContextStackProps {
  project: Project | null;
  projectId: string | null;
  refreshKey?: number;
  expandedWidget: ChatContextExpandedWidget | null;
  expandMotionMode?: ContextPanelExpandMotion;
  onExpandedWidgetChange: (
    widget: ChatContextExpandedWidget | null,
    options?: ExpandedWidgetChangeOptions,
  ) => void;
  /** Open a selected variable as a float companion beside the Variables floor. */
  onOpenVariableDetail?: (variable: Variable) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
  /** How far from the right edge expanded floors sit — shrinks to leave room for a companion FloatLayer. */
  rightInset?: string;
  frameworkPlannedAssessmentIds?: string[];
  frameworkAssessmentInstances?: AssessmentInstance[];
  frameworkAssessmentsLoading?: boolean;
  onAddAssessmentToFrameworkPlan?: (assessmentId: string) => Promise<void>;
  onRemoveAssessmentFromFrameworkPlan?: (assessmentId: string) => Promise<void>;
  onCreateAssessmentInstanceInAssessmentsView?: (assessmentId: string, assessmentName: string) => Promise<void>;
  onOpenExistingAssessmentInstanceInAssessmentsView?: (instance: AssessmentInstance) => Promise<void>;
  frameworkReadOnly?: boolean;
}

function useExpandedPanelVisibility(expandedWidget: ChatContextExpandedWidget | null) {
  const [renderedWidget, setRenderedWidget] = useState<ChatContextExpandedWidget | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (expandedWidget) {
      setVisible(false);
      setRenderedWidget(expandedWidget);

      let outerFrame = 0;
      let innerFrame = 0;
      outerFrame = window.requestAnimationFrame(() => {
        innerFrame = window.requestAnimationFrame(() => {
          setVisible(true);
        });
      });

      return () => {
        window.cancelAnimationFrame(outerFrame);
        window.cancelAnimationFrame(innerFrame);
      };
    }

    setVisible(false);
    const timeout = window.setTimeout(() => {
      setRenderedWidget(null);
    }, CONTEXT_STACK_MOTION_MS);
    return () => window.clearTimeout(timeout);
  }, [expandedWidget]);

  return { renderedWidget, visible };
}

function ContextStackWidgetSlot({
  widgetId,
  expandedWidget,
  renderedWidget,
  children,
}: {
  widgetId: ChatContextExpandedWidget;
  expandedWidget: ChatContextExpandedWidget | null;
  renderedWidget: ChatContextExpandedWidget | null;
  children: ReactNode;
}) {
  return (
    <div
      className={`pointer-events-auto flex min-h-[7rem] min-w-0 flex-1 basis-0 flex-col overflow-hidden ${contextStackTransitionClass} ${contextStackWidgetMotionClass(expandedWidget, widgetId, renderedWidget)}`}
    >
      {children}
    </div>
  );
}

export function ChatContextStack({
  project,
  projectId,
  refreshKey = 0,
  expandedWidget,
  expandMotionMode = 'stack',
  onExpandedWidgetChange,
  onOpenVariableDetail,
  onOpenFile,
  onOpenDocument,
  onOpenWorkspaceAssessment,
  rightInset = '0.75rem',
  frameworkPlannedAssessmentIds = [],
  frameworkAssessmentInstances = [],
  frameworkAssessmentsLoading = false,
  onAddAssessmentToFrameworkPlan,
  onRemoveAssessmentFromFrameworkPlan,
  onCreateAssessmentInstanceInAssessmentsView,
  onOpenExistingAssessmentInstanceInAssessmentsView,
  frameworkReadOnly = false,
}: ChatContextStackProps) {
  const { renderedWidget, visible } = useExpandedPanelVisibility(expandedWidget);
  const [shellMotion, setShellMotion] = useState<ContextPanelExpandMotion>('stack');
  const uploadMaterial = useProjectStore((state) => state.uploadMaterial);
  const deleteMaterial = useProjectStore((state) => state.deleteMaterial);
  const [projectMaterials, setProjectMaterials] = useState<ProjectMaterial[]>([]);
  const [workspaceMaterials, setWorkspaceMaterials] = useState<ProjectMaterial[]>([]);
  const [knowledgeBanks, setKnowledgeBanks] = useState<WorkspaceKnowledgeBank[]>([]);
  const [filesScope, setFilesScope] = useState<FilesScope>('project');
  const [overviewShareModalOpen, setOverviewShareModalOpen] = useState(false);

  const workspaceId = project?.workspace_id ?? null;

  const loadProjectMaterials = useCallback(async () => {
    if (!projectId) {
      setProjectMaterials([]);
      return;
    }
    const store = useProjectStore.getState();
    if (store.materialsProjectId === projectId) {
      setProjectMaterials(store.projectMaterials);
    }
    await store.loadMaterials(projectId);
    const next = useProjectStore.getState();
    if (next.materialsProjectId === projectId) {
      setProjectMaterials(next.projectMaterials);
    }
  }, [projectId]);

  const loadWorkspaceMaterials = useCallback(async () => {
    if (!workspaceId) {
      setWorkspaceMaterials([]);
      setKnowledgeBanks([]);
      return;
    }
    try {
      const [docs, banks] = await Promise.all([
        api.getWorkspaceEvidence(workspaceId),
        api.listWorkspaceKnowledgeBanks(workspaceId),
      ]);
      setWorkspaceMaterials(
        docs.map((doc) => ({
          id: doc.id,
          filename: doc.filename ?? 'Untitled',
          file_type: doc.file_type ?? 'unknown',
          file_size: doc.file_size ?? null,
          created_at: doc.created_at,
          source: 'evidence' as const,
          processing_status: doc.processing_status,
          processing_error: doc.processing_error,
        })),
      );
      setKnowledgeBanks(banks);
    } catch {
      setWorkspaceMaterials([]);
      setKnowledgeBanks([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadProjectMaterials();
  }, [loadProjectMaterials, refreshKey]);

  useEffect(() => {
    if (renderedWidget !== 'files') return;
    void loadWorkspaceMaterials();
  }, [loadWorkspaceMaterials, refreshKey, renderedWidget]);

  useEffect(() => {
    if (renderedWidget !== 'files') {
      setFilesScope('project');
    }
  }, [renderedWidget]);

  useEffect(() => {
    if (renderedWidget !== 'overview') {
      setOverviewShareModalOpen(false);
    }
  }, [renderedWidget]);

  useEffect(() => {
    if (!expandedWidget) {
      setShellMotion('stack');
      return;
    }
    if (expandMotionMode === 'center') {
      setShellMotion('center');
    }
  }, [expandMotionMode, expandedWidget]);

  const openFromStack = useCallback((widget: ChatContextExpandedWidget) => {
    setShellMotion('stack');
    onExpandedWidgetChange(widget, { motion: 'stack' });
  }, [onExpandedWidgetChange]);

  const handleExpandOverview = useCallback(() => {
    openFromStack('overview');
  }, [openFromStack]);

  const handleExpandAssessments = useCallback(() => {
    openFromStack('assessments');
  }, [openFromStack]);

  const handleExpandVariables = useCallback(() => {
    openFromStack('variables');
  }, [openFromStack]);

  const handleExpandFiles = useCallback(() => {
    openFromStack('files');
  }, [openFromStack]);

  const handleCloseExpanded = useCallback(() => {
    onExpandedWidgetChange(null);
  }, [onExpandedWidgetChange]);

  const handleVariableSelect = useCallback((variable: Variable) => {
    onOpenVariableDetail?.(variable);
  }, [onOpenVariableDetail]);

  if (!projectId) return null;

  return (
    <>
      {(shellMotion === 'stack' || !expandedWidget) && (
      <TourAnchor
        id="welcome-context-stack"
        as="div"
        className={`pointer-events-none absolute z-20 right-3 top-3 bottom-3 flex flex-col gap-3 ${contextStackTransitionClass}`}
        style={{ width: CHAT_CONTEXT_STACK_WIDTH }}
      >
        <ContextStackWidgetSlot
          widgetId="overview"
          expandedWidget={expandedWidget}
          renderedWidget={renderedWidget}
        >
          <ProjectContextPanel
            variant="stacked"
            project={project}
            refreshKey={refreshKey}
            onViewAll={handleExpandOverview}
          />
        </ContextStackWidgetSlot>

        <ContextStackWidgetSlot
          widgetId="variables"
          expandedWidget={expandedWidget}
          renderedWidget={renderedWidget}
        >
          <ProjectVariablesPanel
            projectId={projectId}
            refreshKey={refreshKey}
            onVariableSelect={handleVariableSelect}
            onViewAll={handleExpandVariables}
          />
        </ContextStackWidgetSlot>

        <ContextStackWidgetSlot
          widgetId="assessments"
          expandedWidget={expandedWidget}
          renderedWidget={renderedWidget}
        >
          <ProjectAssessmentsPanel
            plannedAssessmentIds={frameworkPlannedAssessmentIds}
            assessmentInstances={frameworkAssessmentInstances}
            loading={frameworkAssessmentsLoading}
            readOnly={frameworkReadOnly}
            onViewAll={handleExpandAssessments}
            onOpenAssessment={onOpenWorkspaceAssessment}
            onStartAssessment={frameworkReadOnly ? undefined : onCreateAssessmentInstanceInAssessmentsView}
          />
        </ContextStackWidgetSlot>

        <ContextStackWidgetSlot
          widgetId="files"
          expandedWidget={expandedWidget}
          renderedWidget={renderedWidget}
        >
          <ProjectFilesPanel
            projectId={projectId}
            refreshKey={refreshKey}
            onOpenFile={onOpenFile}
            onViewAll={handleExpandFiles}
          />
        </ContextStackWidgetSlot>
      </TourAnchor>
      )}

      {renderedWidget === 'overview' && project && (
        <FloorLayer
          widget="overview"
          title="Overview"
          suffix={projectDisplayName(project)}
          visible={visible}
          motionMode={shellMotion}
          onClose={handleCloseExpanded}
          flushOnExpand
          rightInset={rightInset}
          headerActions={
            !project.shared_role || project.shared_role === 'editor' ? (
              <button
                type="button"
                onClick={() => setOverviewShareModalOpen(true)}
                className="flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg border border-stroke-subtle bg-white text-text-secondary hover:border-accent hover:text-accent transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                Share
              </button>
            ) : undefined
          }
        >
          <ProjectOverviewExpandedPanel
            project={project}
            refreshKey={refreshKey}
            shareModalOpen={overviewShareModalOpen}
            onShareModalChange={setOverviewShareModalOpen}
            onOpenDocument={onOpenDocument}
            onOpenWorkspaceAssessment={onOpenWorkspaceAssessment}
          />
        </FloorLayer>
      )}

      {renderedWidget === 'variables' && (
        <FloorLayer
          widget="variables"
          title={PROJECT_VARIABLES.title}
          suffix={project ? projectDisplayName(project) : null}
          visible={visible}
          motionMode={shellMotion}
          onClose={handleCloseExpanded}
          flushOnExpand
          rightInset={rightInset}
          tourId="feature-variables"
        >
          <VariablesWorkspaceTab
            projectId={projectId}
            embedded
            showDetailPanel={false}
            onOpenDocument={onOpenDocument}
            onOpenFile={onOpenFile}
            onVariableSelectInChat={onOpenVariableDetail}
          />
        </FloorLayer>
      )}

      {renderedWidget === 'files' && (
        <FloorLayer
          widget="files"
          title="Files"
          suffix={
            filesScope === 'workspace'
              ? 'Workspace'
              : project
                ? projectDisplayName(project)
                : null
          }
          visible={visible}
          motionMode={shellMotion}
          onClose={handleCloseExpanded}
          flushOnExpand
          rightInset={rightInset}
          tourId="feature-files"
          headerActions={
            <FilesScopeToggle value={filesScope} onChange={setFilesScope} />
          }
        >
          {filesScope === 'workspace' ? (
            <ProjectFilesView
              scope="workspace"
              title="Workspace files"
              description="Shared guidance and reusable context for this workspace."
              materials={workspaceMaterials}
              knowledgeBanks={knowledgeBanks}
              onUploadFile={
                workspaceId
                  ? async (file) => {
                      await api.uploadWorkspaceEvidence(workspaceId, file);
                      await loadWorkspaceMaterials();
                    }
                  : undefined
              }
              onDeleteMaterial={async (materialId) => {
                await api.deleteEvidence(materialId);
                await loadWorkspaceMaterials();
              }}
            />
          ) : (
            <ProjectFilesView
              scope="project"
              projectId={projectId}
              title={`${projectDisplayName(project)} files`}
              materials={projectMaterials}
              onUploadFile={async (file) => {
                await uploadMaterial(projectId, file);
                await loadProjectMaterials();
              }}
              onDeleteMaterial={async (materialId, source) => {
                await deleteMaterial(materialId, source);
                await loadProjectMaterials();
              }}
            />
          )}
        </FloorLayer>
      )}

      {renderedWidget === 'assessments' && onAddAssessmentToFrameworkPlan && onRemoveAssessmentFromFrameworkPlan
        && onCreateAssessmentInstanceInAssessmentsView && onOpenExistingAssessmentInstanceInAssessmentsView && (
        <FloorLayer
          widget="assessments"
          title="Assessments"
          suffix={project ? projectDisplayName(project) : null}
          visible={visible}
          motionMode={shellMotion}
          onClose={handleCloseExpanded}
          flushOnExpand
          rightInset={rightInset}
          tourId="feature-assessments"
        >
          <FrameworkPlanView
            plannedAssessmentIds={frameworkPlannedAssessmentIds}
            assessmentInstances={frameworkAssessmentInstances}
            loading={frameworkAssessmentsLoading}
            onAddAssessmentToFrameworkPlan={onAddAssessmentToFrameworkPlan}
            onRemoveAssessmentFromFrameworkPlan={onRemoveAssessmentFromFrameworkPlan}
            onCreateAssessmentInstanceInAssessmentsView={onCreateAssessmentInstanceInAssessmentsView}
            onOpenExistingAssessmentInstanceInAssessmentsView={onOpenExistingAssessmentInstanceInAssessmentsView}
            readOnly={frameworkReadOnly}
            onOpenAssessment={(assessment) => {
              void onOpenExistingAssessmentInstanceInAssessmentsView(assessment);
            }}
          />
        </FloorLayer>
      )}
    </>
  );
}

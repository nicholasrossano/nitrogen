'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { ProjectContextPanel } from '@/components/chat-shell/ProjectContextPanel';
import { ProjectAssumptionsPanel } from '@/components/chat-shell/ProjectAssumptionsPanel';
import { ProjectFilesPanel } from '@/components/chat-shell/ProjectFilesPanel';
import { ChatExpandablePanelShell } from '@/components/chat-shell/ChatExpandablePanelShell';
import {
  contextStackTransitionClass,
  contextStackWidgetMotionClass,
  CONTEXT_STACK_MOTION_MS,
  type ChatContextExpandedWidget,
} from '@/components/chat-shell/chatContextStackMotion';
import { CHAT_CONTEXT_STACK_WIDTH } from '@/components/ui/chatSidebarLayout';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { api, type Assumption, type Project, type ProjectMaterial } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ProjectOverviewExpandedPanel } from '@/components/chat-shell/ProjectOverviewExpandedPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';

export type { ChatContextExpandedWidget };

const AssumptionsWorkspaceTab = dynamic(
  () => import('@/components/assumptions/AssumptionsWorkspaceTab').then((m) => m.AssumptionsWorkspaceTab),
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
  onExpandedWidgetChange: (widget: ChatContextExpandedWidget | null) => void;
  variablesFocusId?: string | null;
  onVariablesFocusIdChange?: (assumptionId: string | null) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
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
  className,
  children,
}: {
  widgetId: ChatContextExpandedWidget;
  expandedWidget: ChatContextExpandedWidget | null;
  renderedWidget: ChatContextExpandedWidget | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${contextStackTransitionClass} ${contextStackWidgetMotionClass(expandedWidget, widgetId, renderedWidget)} ${className ?? ''}`.trim()}
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
  onExpandedWidgetChange,
  variablesFocusId = null,
  onVariablesFocusIdChange,
  onOpenFile,
  onOpenDocument,
  onOpenWorkspaceAssessment,
}: ChatContextStackProps) {
  const { renderedWidget, visible } = useExpandedPanelVisibility(expandedWidget);
  const uploadMaterial = useInitiativeStore((state) => state.uploadMaterial);
  const deleteMaterial = useInitiativeStore((state) => state.deleteMaterial);
  const [projectMaterials, setProjectMaterials] = useState<ProjectMaterial[]>([]);
  const [overviewShareModalOpen, setOverviewShareModalOpen] = useState(false);

  const loadProjectMaterials = useCallback(async () => {
    if (!projectId) {
      setProjectMaterials([]);
      return;
    }
    try {
      const materials = await api.getMaterials(projectId);
      setProjectMaterials(materials);
    } catch {
      setProjectMaterials([]);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProjectMaterials();
  }, [loadProjectMaterials, refreshKey]);

  useEffect(() => {
    if (renderedWidget !== 'overview') {
      setOverviewShareModalOpen(false);
    }
  }, [renderedWidget]);

  const handleExpandOverview = useCallback(() => {
    onExpandedWidgetChange('overview');
  }, [onExpandedWidgetChange]);

  const handleExpandVariables = useCallback(() => {
    onExpandedWidgetChange('variables');
  }, [onExpandedWidgetChange]);

  const handleExpandFiles = useCallback(() => {
    onExpandedWidgetChange('files');
  }, [onExpandedWidgetChange]);

  const handleCloseExpanded = useCallback(() => {
    onExpandedWidgetChange(null);
    onVariablesFocusIdChange?.(null);
  }, [onExpandedWidgetChange, onVariablesFocusIdChange]);

  const handleAssumptionSelect = useCallback((assumption: Assumption) => {
    onVariablesFocusIdChange?.(assumption.id);
    onExpandedWidgetChange('variables');
  }, [onExpandedWidgetChange, onVariablesFocusIdChange]);

  if (!projectId) return null;

  return (
    <>
      <div
        className={`pointer-events-none absolute z-20 right-3 top-3 bottom-3 flex flex-col gap-3 ${contextStackTransitionClass}`}
        style={{ width: CHAT_CONTEXT_STACK_WIDTH }}
      >
        <div className="pointer-events-auto min-h-0">
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
        </div>

        <ContextStackWidgetSlot
          widgetId="variables"
          expandedWidget={expandedWidget}
          renderedWidget={renderedWidget}
          className="pointer-events-auto flex min-h-[8rem] min-w-0 flex-col"
        >
          <ProjectAssumptionsPanel
            projectId={projectId}
            refreshKey={refreshKey}
            onAssumptionSelect={handleAssumptionSelect}
            onViewAll={handleExpandVariables}
          />
        </ContextStackWidgetSlot>

        <ContextStackWidgetSlot
          widgetId="files"
          expandedWidget={expandedWidget}
          renderedWidget={renderedWidget}
          className="pointer-events-auto flex min-h-0 min-w-0 shrink-0 flex-col"
        >
          <ProjectFilesPanel
            projectId={projectId}
            refreshKey={refreshKey}
            onOpenFile={onOpenFile}
            onViewAll={handleExpandFiles}
          />
        </ContextStackWidgetSlot>
      </div>

      {renderedWidget === 'overview' && project && (
        <ChatExpandablePanelShell
          widget="overview"
          title="Overview"
          suffix={project.name}
          visible={visible}
          onClose={handleCloseExpanded}
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
        </ChatExpandablePanelShell>
      )}

      {renderedWidget === 'variables' && (
        <ChatExpandablePanelShell
          widget="variables"
          title={PROJECT_VARIABLES.title}
          suffix={project?.name ?? null}
          visible={visible}
          onClose={handleCloseExpanded}
        >
          <AssumptionsWorkspaceTab
            initiativeId={projectId}
            embedded
            showDetailPanel
            focusAssumptionId={variablesFocusId}
          />
        </ChatExpandablePanelShell>
      )}

      {renderedWidget === 'files' && (
        <ChatExpandablePanelShell
          widget="files"
          title="Files"
          suffix={project?.name ?? null}
          visible={visible}
          onClose={handleCloseExpanded}
        >
          <ProjectFilesView
            scope="project"
            initiativeId={projectId}
            title={`${project?.name ?? 'Project'} files`}
            materials={projectMaterials}
            onUploadFile={async (file) => {
              await uploadMaterial(projectId, file);
              await loadProjectMaterials();
            }}
            onDeleteMaterial={async (materialId) => {
              await deleteMaterial(materialId);
              await loadProjectMaterials();
            }}
          />
        </ChatExpandablePanelShell>
      )}
    </>
  );
}

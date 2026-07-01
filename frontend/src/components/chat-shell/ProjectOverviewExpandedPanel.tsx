'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { StatusOverviewTable } from '@/components/project-status/StatusOverviewTable';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { ShareProjectModal } from '@/components/sharing/ShareProjectModal';
import { api, type Project, type ProjectShare } from '@/lib/api';
import {
  buildCollaborators,
  CollaboratorRow,
} from '@/components/chat-shell/projectContextCollaborators';

interface ProjectOverviewExpandedPanelProps {
  project: Project;
  refreshKey?: number;
  shareModalOpen?: boolean;
  onShareModalChange?: (open: boolean) => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
}

export function ProjectOverviewExpandedPanel({
  project,
  refreshKey = 0,
  shareModalOpen,
  onShareModalChange,
  onOpenDocument,
  onOpenWorkspaceAssessment,
}: ProjectOverviewExpandedPanelProps) {
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [internalShareModalOpen, setInternalShareModalOpen] = useState(false);
  const showShareModal = shareModalOpen ?? internalShareModalOpen;

  const loadShares = useCallback(async () => {
    setCollaboratorsLoading(true);
    try {
      const data = await api.getShares(project.id);
      setShares(data);
    } catch {
      setShares([]);
    } finally {
      setCollaboratorsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadShares();
  }, [loadShares, refreshKey]);

  const handleCloseShareModal = useCallback(() => {
    if (onShareModalChange) {
      onShareModalChange(false);
    } else {
      setInternalShareModalOpen(false);
    }
    void loadShares();
  }, [loadShares, onShareModalChange]);

  const collaborators = useMemo(
    () => buildCollaborators(project, shares),
    [project, shares],
  );

  const overviewText =
    project?.overview_description?.trim() ||
    project.subject?.trim() ||
    null;
  const readOnly = project.shared_role === 'viewer';
  const ownerEmail = project.owner_email ?? project?.owner_email ?? null;

  return (
    <>
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
            Description
          </p>
          <div className="mt-2">
            {overviewText ? (
              <p className="text-sm leading-7 text-text-secondary whitespace-pre-wrap">
                {overviewText}
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium text-text-primary">No overview yet</p>
                <p className="mt-1 text-sm text-text-tertiary">
                  Upload files or add a project subject to populate this summary.
                </p>
              </div>
            )}
          </div>
        </section>

        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
            Status
          </p>
          <div className="mt-2">
            <StatusOverviewTable
              initiativeId={project.id}
              readOnly={readOnly}
              refreshToken={refreshKey}
              onOpenDocument={onOpenDocument}
              onOpenWorkspaceAssessment={onOpenWorkspaceAssessment}
            />
          </div>
        </section>

        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
            Collaborators
          </p>
          <div className="mt-2 rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-3">
            {collaboratorsLoading ? (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading…
              </div>
            ) : (
              <ul>
                {collaborators.map((collaborator) => (
                  <CollaboratorRow key={collaborator.id} {...collaborator} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>

    {showShareModal && (
      <ShareProjectModal
        projectId={project.id}
        ownerEmail={ownerEmail}
        onClose={handleCloseShareModal}
      />
    )}
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectFilesView } from '@/components/files';
import { ChangeProjectSelect } from '@/components/chat-shell/ChangeProjectSelect';
import { resolveActiveProjectId, writeLastProjectId } from '@/components/chat-shell/ChatShellProvider';
import { api, type Project, type ProjectMaterial, type WorkspaceKnowledgeBank } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useProjectStore } from '@/stores/projectStore';

type FilesScope = 'company' | 'project';

function FilesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get('project');
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();
  const [scope, setScope] = useState<FilesScope>('project');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectParam);
  const [workspaceMaterials, setWorkspaceMaterials] = useState<ProjectMaterial[]>([]);
  const [projectMaterials, setProjectMaterials] = useState<ProjectMaterial[]>([]);
  const [knowledgeBanks, setKnowledgeBanks] = useState<WorkspaceKnowledgeBank[]>([]);

  const uploadMaterial = useProjectStore((s) => s.uploadMaterial);

  useEffect(() => {
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces]);

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setProjects([]);
      setProjectsLoaded(false);
      return;
    }
    setProjectsLoaded(false);
    api.listProjects(100, 0, false, activeWorkspace.id)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoaded(true));
  }, [activeWorkspace?.id]);

  const effectiveProjectId = useMemo(
    () => resolveActiveProjectId('/chat/files', projectParam, projects),
    [projectParam, projects],
  );

  useEffect(() => {
    if (!projectsLoaded || !effectiveProjectId) return;
    writeLastProjectId(effectiveProjectId);
    setSelectedProjectId(effectiveProjectId);
    if (effectiveProjectId !== projectParam) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('project', effectiveProjectId);
      router.replace(`/chat/files?${params.toString()}`);
    }
  }, [effectiveProjectId, projectParam, projectsLoaded, router, searchParams]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const handleProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    writeLastProjectId(projectId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('project', projectId);
    router.replace(`/chat/files?${params.toString()}`);
  }, [router, searchParams]);

  const loadCompanyFiles = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    const docs = await api.getWorkspaceEvidence(activeWorkspace.id);
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
    const banks = await api.listWorkspaceKnowledgeBanks(activeWorkspace.id);
    setKnowledgeBanks(banks);
  }, [activeWorkspace?.id]);

  const loadProjectFiles = useCallback(async (projectId: string) => {
    const materials = await api.getMaterials(projectId);
    setProjectMaterials(materials);
  }, []);

  useEffect(() => {
    if (scope === 'company') {
      void loadCompanyFiles();
      return;
    }
    if (selectedProjectId) void loadProjectFiles(selectedProjectId);
  }, [scope, selectedProjectId, loadCompanyFiles, loadProjectFiles]);

  return (
    <main className="flex-1 min-h-0 h-full bg-surface overflow-auto">
        <div className="px-4 py-3 border-b border-divider flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScope('company')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              scope === 'company' ? 'bg-surface-subtle text-text-primary' : 'text-text-secondary hover:bg-black/[0.04]'
            }`}
          >
            Workspace Files
          </button>
          <button
            type="button"
            onClick={() => setScope('project')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              scope === 'project' ? 'bg-surface-subtle text-text-primary' : 'text-text-secondary hover:bg-black/[0.04]'
            }`}
          >
            Project Files
          </button>
          <ChangeProjectSelect
            projects={projects}
            value={effectiveProjectId}
            onChange={handleProjectChange}
            size="default"
            rootClassName={`ml-auto ${scope === 'company' ? 'invisible' : ''}`}
          />
        </div>

        {scope === 'company' ? (
          <ProjectFilesView
            scope="workspace"
            title="Workspace Files"
            description="Shared guidance and reusable context for your firm."
            materials={workspaceMaterials}
            knowledgeBanks={knowledgeBanks}
            onUploadFile={async (file) => {
              if (!activeWorkspace?.id) return;
              await api.uploadWorkspaceEvidence(activeWorkspace.id, file);
              await loadCompanyFiles();
            }}
            onDeleteMaterial={async (id) => {
              await api.deleteEvidence(id);
              await loadCompanyFiles();
            }}
          />
        ) : effectiveProjectId ? (
          <ProjectFilesView
            scope="project"
            projectId={effectiveProjectId}
            title={`${selectedProject?.name ?? 'Project'} files`}
            materials={projectMaterials}
            onUploadFile={async (file) => {
              await uploadMaterial(effectiveProjectId, file);
              await loadProjectFiles(effectiveProjectId);
            }}
            onDeleteMaterial={async (id) => {
              await api.deleteMaterial(id);
              await loadProjectFiles(effectiveProjectId);
            }}
          />
        ) : (
          <div className="p-8 text-sm text-text-secondary">No projects available yet.</div>
        )}
    </main>
  );
}

export default function ChatFilesPage() {
  return (
    <ProtectedRoute>
      <FilesPageContent />
    </ProtectedRoute>
  );
}

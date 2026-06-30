import { create } from 'zustand';
import {
  api,
  Project,
  MemoContent,
  EvidenceDoc,
  ProjectPlan,
  ProjectMaterial,
  DriveImportResult,
  DriveSyncResult,
  DriveLinkedFile,
} from '@/lib/api';

interface ProjectState {
  project: Project | null;
  memo: MemoContent | null;
  memoId: string | null;
  evidenceDocs: EvidenceDoc[];
  projectMaterials: ProjectMaterial[];
  driveLinkedFiles: DriveLinkedFile[];
  projectPlan: ProjectPlan | null;

  loading: boolean;
  generating: boolean;
  projectPlanLoading: boolean;
  error: string | null;

  draftMessage: string | null;
  setDraftMessage: (msg: string | null) => void;

  loadProject: (id: string) => Promise<void>;
  loadEvidence: (id: string) => Promise<void>;
  loadMaterials: (id: string) => Promise<void>;
  uploadMaterial: (id: string, file: File) => Promise<void>;
  deleteMaterial: (materialId: string) => Promise<void>;
  loadDriveLinkedFiles: (id: string) => Promise<void>;
  importFromDrive: (id: string, fileIds: string[]) => Promise<DriveImportResult>;
  syncDriveFiles: (id: string) => Promise<DriveSyncResult>;
  confirmIntake: (id: string) => Promise<void>;
  uploadEvidence: (id: string, file: File) => Promise<void>;
  pasteEvidence: (id: string, content: string, title?: string) => Promise<void>;
  deleteEvidence: (evidenceId: string) => Promise<void>;
  exportMemo: (id: string) => Promise<void>;
  selectTools: (id: string, toolIds: string[]) => Promise<void>;
  generateProjectOverview: (id: string) => Promise<Project>;
  updateTitle: (id: string, title: string) => Promise<void>;
  _refreshPlanInBackground: (id: string) => Promise<void>;
  loadProjectPlan: (id: string) => Promise<void>;
  generateProjectPlan: (id: string) => Promise<void>;
  updatePlanItemStatus: (id: string, itemId: string, status: 'not_started' | 'in_progress' | 'complete') => Promise<void>;
  deletePlanItem: (id: string, itemId: string) => Promise<void>;
  addPlanItem: (id: string, pillarId: string, title: string, itemType?: 'deliverable' | 'assessment', phaseId?: string) => Promise<void>;
  reset: () => void;
}

let latestLoadProjectRequest = 0;

function withRequestTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

const activeProcessingPolls = new Set<string>();

async function schedulePollForProcessing(
  projectId: string,
  get: () => ProjectState,
  set: (partial: Partial<ProjectState> | ((state: ProjectState) => Partial<ProjectState>)) => void,
): Promise<void> {
  if (activeProcessingPolls.has(projectId)) return;
  activeProcessingPolls.add(projectId);

  const POLL_INTERVAL_MS = 1500;
  const MAX_POLLS = 80;

  try {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      let evidenceDocs: EvidenceDoc[];
      try {
        evidenceDocs = await api.getEvidence(projectId);
      } catch {
        continue;
      }

      set((state) => ({
        evidenceDocs,
        projectMaterials: state.projectMaterials.map((m) => {
          const match = evidenceDocs.find((d) => d.id === m.id);
          if (!match) return m;
          return {
            ...m,
            filename: match.filename ?? m.filename,
            file_type: match.file_type ?? m.file_type,
            file_size: match.file_size ?? m.file_size,
            processing_status: match.processing_status ?? m.processing_status,
            processing_error: match.processing_error ?? m.processing_error,
          };
        }),
      }));

      const stillProcessing = evidenceDocs.some(
        (d) =>
          d.processing_status === 'uploaded' ||
          d.processing_status === 'processing' ||
          d.processing_status === 'lightweight_ready',
      );
      if (!stillProcessing) {
        try {
          const project = await api.getProject(projectId);
          set({ project });
          get()._refreshPlanInBackground(projectId);
        } catch {
          // Non-fatal.
        }
        return;
      }
    }
  } finally {
    activeProcessingPolls.delete(projectId);
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  memo: null,
  memoId: null,
  evidenceDocs: [],
  projectMaterials: [],
  driveLinkedFiles: [],
  projectPlan: null,
  loading: false,
  generating: false,
  projectPlanLoading: false,
  error: null,
  draftMessage: null,
  setDraftMessage: (msg) => set({ draftMessage: msg }),

  loadProject: async (id: string) => {
    const requestId = ++latestLoadProjectRequest;
    set({ loading: true, error: null });
    try {
      const project = await withRequestTimeout(
        api.getProject(id),
        'Project took too long to load. Please refresh and try again.',
      );
      if (requestId !== latestLoadProjectRequest) return;
      set({
        project,
        loading: false,
        projectPlan: project.project_plan ?? null,
      });
    } catch (error) {
      if (requestId !== latestLoadProjectRequest) return;
      set({
        error: error instanceof Error ? error.message : 'Failed to load project',
        loading: false,
      });
    }
  },

  loadEvidence: async (id: string) => {
    try {
      const evidenceDocs = await api.getEvidence(id);
      set({ evidenceDocs });
    } catch (error) {
      console.error('Failed to load evidence:', error);
    }
  },

  loadMaterials: async (id: string) => {
    try {
      const projectMaterials = await api.getMaterials(id);
      set({ projectMaterials });
    } catch (error) {
      console.error('Failed to load materials:', error);
    }
  },

  uploadMaterial: async (id: string, file: File) => {
    try {
      const response = await api.uploadEvidence(id, file);
      const doc: EvidenceDoc = response.document;
      const asMaterial: ProjectMaterial = {
        id: doc.id,
        filename: doc.filename ?? file.name,
        file_type: doc.file_type ?? '',
        file_size: doc.file_size ?? file.size,
        created_at: doc.created_at,
        source: 'evidence',
        processing_status: doc.processing_status ?? 'uploaded',
        processing_error: doc.processing_error ?? null,
      };
      set((state) => ({
        projectMaterials: [asMaterial, ...state.projectMaterials],
        evidenceDocs: [doc, ...state.evidenceDocs],
      }));
      schedulePollForProcessing(id, get, set);
    } catch (error) {
      console.error('Failed to upload material:', error);
      throw error;
    }
  },

  deleteMaterial: async (materialId: string) => {
    const prev = get().projectMaterials;
    const mat = prev.find((m) => m.id === materialId);
    const isEvidence = mat?.source === 'evidence';

    set((state) => ({
      projectMaterials: state.projectMaterials.filter((m) => m.id !== materialId),
    }));
    try {
      if (isEvidence) {
        await api.deleteEvidence(materialId);
        set((state) => ({
          evidenceDocs: state.evidenceDocs.filter((d) => d.id !== materialId),
        }));
      } else {
        await api.deleteMaterial(materialId);
      }
    } catch (error) {
      set({ projectMaterials: prev });
      console.error('Failed to delete material:', error);
      throw error;
    }
  },

  loadDriveLinkedFiles: async (id: string) => {
    try {
      const links = await api.getDriveLinkedFiles(id);
      set({ driveLinkedFiles: links });
    } catch (error) {
      console.error('Failed to load Drive linked files:', error);
    }
  },

  importFromDrive: async (id: string, fileIds: string[]) => {
    const result = await api.importFromDrive(id, fileIds);
    if (result.imported.length > 0) {
      const newMaterials: ProjectMaterial[] = result.imported.map((f) => ({
        id: f.id,
        filename: f.filename,
        file_type: f.file_type,
        file_size: f.file_size,
        created_at: f.created_at,
        source: 'evidence',
      }));
      const links = await api.getDriveLinkedFiles(id);
      set((state) => ({
        projectMaterials: [...newMaterials, ...state.projectMaterials],
        driveLinkedFiles: links,
      }));
    }
    return result;
  },

  syncDriveFiles: async (id: string) => {
    const result = await api.syncDriveFiles(id);
    if (result.updated > 0) {
      const projectMaterials = await api.getMaterials(id);
      set({ projectMaterials });
    }
    return result;
  },

  confirmIntake: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.confirmProject(id);
      const project = await api.getProject(id);
      set({ project, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to confirm',
        loading: false,
      });
    }
  },

  uploadEvidence: async (id: string, file: File) => {
    set({ loading: true, error: null });
    try {
      const response = await api.uploadEvidence(id, file);
      const doc: EvidenceDoc = response.document;
      const asMaterial: ProjectMaterial = {
        id: doc.id,
        filename: doc.filename ?? file.name,
        file_type: doc.file_type ?? '',
        file_size: doc.file_size ?? file.size,
        created_at: doc.created_at,
        source: 'evidence',
        processing_status: doc.processing_status ?? 'uploaded',
        processing_error: doc.processing_error ?? null,
      };

      set((state) => ({
        evidenceDocs: [doc, ...state.evidenceDocs.filter((d) => d.id !== doc.id)],
        projectMaterials: [
          asMaterial,
          ...state.projectMaterials.filter((m) => m.id !== doc.id),
        ],
        loading: false,
        error: null,
      }));

      schedulePollForProcessing(id, get, set);
    } catch (error) {
      console.error('Failed to upload evidence:', error);
      set({ loading: false, error: null });
      throw error;
    }
  },

  pasteEvidence: async (id: string, content: string, title?: string) => {
    set({ loading: true, error: null });
    try {
      await api.pasteEvidence(id, content, title);
      const project = await api.getProject(id);
      set({ project, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to save text',
        loading: false,
      });
    }
  },

  deleteEvidence: async (evidenceId: string) => {
    set({ loading: true, error: null });
    try {
      await api.deleteEvidence(evidenceId);
      const evidenceDocs = get().evidenceDocs;
      const updatedDocs = evidenceDocs.filter((doc) => doc.id !== evidenceId);
      set({ evidenceDocs: updatedDocs, loading: false });

      const project = get().project;
      if (project) get()._refreshPlanInBackground(project.id);
    } catch (error) {
      console.error('Failed to delete evidence:', error);
      set({ loading: false, error: null });
      throw error;
    }
  },

  exportMemo: async (id: string) => {
    const { memoId } = get();
    set({ loading: true, error: null });
    try {
      const response = await api.exportMemo(id, memoId || undefined);
      await api.downloadExport(response.export_id);
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to export',
        loading: false,
      });
    }
  },

  selectTools: async (id: string, toolIds: string[]) => {
    set({ loading: true, error: null });
    try {
      const response = await api.selectTools(id, toolIds);
      set((state) => ({
        project: state.project
          ? {
              ...state.project,
              selected_tools: response.selected_tools,
              stage: response.stage,
            }
          : state.project,
        loading: false,
      }));
    } catch (error) {
      console.error('selectTools: error', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to select tools',
        loading: false,
      });
    }
  },

  generateProjectOverview: async (id: string) => {
    const project = await api.generateProjectOverview(id);
    set((state) => ({
      project,
      projectPlan: project.project_plan ?? state.projectPlan,
    }));
    return project;
  },

  updateTitle: async (id: string, title: string) => {
    try {
      const project = await api.updateProject(id, { title });
      set({ project });
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  },

  _refreshPlanInBackground: async (id: string) => {
    const { projectPlan } = get();
    if (!projectPlan) return;
    try {
      set({ projectPlanLoading: true });
      const response = await api.generateProjectPlan(id);
      set({ projectPlan: response.project_plan, projectPlanLoading: false });
    } catch {
      set({ projectPlanLoading: false });
    }
  },

  loadProjectPlan: async (id: string) => {
    try {
      const response = await api.getProjectPlan(id);
      set({ projectPlan: response.project_plan });
    } catch (error) {
      console.error('Failed to load project plan:', error);
    }
  },

  generateProjectPlan: async (id: string) => {
    set({ projectPlanLoading: true, error: null });
    try {
      const response = await api.generateProjectPlan(id);
      set({ projectPlan: response.project_plan, projectPlanLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to generate project plan',
        projectPlanLoading: false,
      });
    }
  },

  updatePlanItemStatus: async (id: string, itemId: string, status: 'not_started' | 'in_progress' | 'complete') => {
    const { projectPlan } = get();
    if (!projectPlan) return;

    const updatedPillars = projectPlan.pillars.map((pillar) => ({
      ...pillar,
      items: pillar.items.map((item) => (item.id === itemId ? { ...item, status } : item)),
    }));
    set({ projectPlan: { ...projectPlan, pillars: updatedPillars } });

    try {
      await api.updatePlanItemStatus(id, itemId, status);
    } catch (error) {
      set({ projectPlan });
      console.error('Failed to update plan item status:', error);
    }
  },

  deletePlanItem: async (id: string, itemId: string) => {
    const { projectPlan } = get();
    if (!projectPlan) return;

    const updatedPillars = projectPlan.pillars.map((pillar) => ({
      ...pillar,
      items: pillar.items.filter((item) => item.id !== itemId),
    }));
    set({ projectPlan: { ...projectPlan, pillars: updatedPillars } });

    try {
      await api.deletePlanItem(id, itemId);
    } catch (error) {
      set({ projectPlan });
      console.error('Failed to delete plan item:', error);
    }
  },

  addPlanItem: async (
    id: string,
    pillarId: string,
    title: string,
    itemType: 'deliverable' | 'assessment' = 'deliverable',
    phaseId?: string,
  ) => {
    const { projectPlan } = get();
    if (!projectPlan) return;

    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const newItem = {
      id: tempId,
      title,
      item_type: itemType,
      classification: 'optional' as const,
      status: 'not_started' as const,
      rationale: '',
      user_added: true,
      ...(phaseId ? { phase: phaseId, phase_order: 999 } : {}),
    };

    const updatedPillars = projectPlan.pillars.map((p) =>
      p.id === pillarId ? { ...p, items: [...p.items, newItem] } : p,
    );
    set({ projectPlan: { ...projectPlan, pillars: updatedPillars } });

    try {
      const result = await api.addPlanItem(id, pillarId, title, itemType, phaseId);
      const currentPlan = get().projectPlan;
      if (!currentPlan) return;
      const finalPillars = currentPlan.pillars.map((p) =>
        p.id === pillarId
          ? { ...p, items: p.items.map((i) => (i.id === tempId ? result.item : i)) }
          : p,
      );
      set({ projectPlan: { ...currentPlan, pillars: finalPillars } });
    } catch (error) {
      const currentPlan = get().projectPlan;
      if (!currentPlan) return;
      const rollbackPillars = currentPlan.pillars.map((p) =>
        p.id === pillarId ? { ...p, items: p.items.filter((i) => i.id !== tempId) } : p,
      );
      set({ projectPlan: { ...currentPlan, pillars: rollbackPillars } });
      console.error('Failed to add plan item:', error);
    }
  },

  reset: () => {
    set({
      project: null,
      memo: null,
      memoId: null,
      evidenceDocs: [],
      projectMaterials: [],
      driveLinkedFiles: [],
      projectPlan: null,
      loading: false,
      generating: false,
      projectPlanLoading: false,
      error: null,
    });
  },
}));

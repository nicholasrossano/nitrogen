import { create } from 'zustand';
import {
  api,
  Project,
  EvidenceDoc,
  ProjectPlan,
  ProjectMaterial,
  DriveImportResult,
  DriveSyncResult,
  DriveLinkedFile,
} from '@/lib/api';
import { getCached, setCached, swrKeys } from '@/lib/swrCache';
import { ApiError } from '@/lib/api/client';

function notifyProjectSignalsUpdated(projectId?: string | null) {
  if (typeof window === 'undefined' || !projectId) return;
  window.dispatchEvent(
    new CustomEvent('nitrogen:project-signals-updated', {
      detail: { projectId },
    }),
  );
}

interface ProjectState {
  project: Project | null;
  /** Warm by-id cache so chrome (title) never blanks on soft nav / project switch. */
  projectsById: Record<string, Project>;
  /**
   * Permanent (404/403) load failures keyed by project id — "this account has
   * no access", not "retry me". Consumers must stop re-requesting and show an
   * error/escape hatch instead of spinning forever once an id lands here.
   */
  projectAccessErrors: Record<string, { status: number; message: string }>;
  evidenceDocs: EvidenceDoc[];
  projectMaterials: ProjectMaterial[];
  /** Which projectId `projectMaterials` currently belongs to. */
  materialsProjectId: string | null;
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
  /**
   * Upload a file attached from the chat composer. Unlike `uploadMaterial`
   * (which goes through the async evidence/RAG pipeline), this hits the
   * synchronous `/materials` endpoint so extracted text is available
   * immediately — the caller (chat) needs it for the very next reply, not
   * just for later retrieval. Returns the created material so the composer
   * can attach it to the outgoing message.
   */
  uploadChatAttachment: (id: string, file: File) => Promise<ProjectMaterial>;
  deleteMaterial: (materialId: string, source?: string | null) => Promise<void>;
  loadDriveLinkedFiles: (id: string) => Promise<void>;
  importFromDrive: (id: string, fileIds: string[]) => Promise<DriveImportResult>;
  syncDriveFiles: (id: string) => Promise<DriveSyncResult>;
  confirmIntake: (id: string) => Promise<void>;
  uploadEvidence: (id: string, file: File) => Promise<void>;
  pasteEvidence: (id: string, content: string, title?: string) => Promise<void>;
  deleteEvidence: (evidenceId: string) => Promise<void>;
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
const loadMaterialsInflight = new Map<string, Promise<void>>();

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

      set((state) => {
        const projectMaterials = state.projectMaterials.map((m) => {
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
        });
        if (state.materialsProjectId === projectId) {
          setCached(swrKeys.materials(projectId), projectMaterials);
        }
        return { evidenceDocs, projectMaterials };
      });

      const stillProcessing = evidenceDocs.some(
        (d) =>
          d.processing_status === 'uploaded' ||
          d.processing_status === 'processing' ||
          d.processing_status === 'lightweight_ready',
      );
      if (!stillProcessing) {
        try {
          const project = await api.getProject(projectId);
          rememberProject(set, project);
          get()._refreshPlanInBackground(projectId);
        } catch {
          // Non-fatal.
        }
        notifyProjectSignalsUpdated(projectId);
        return;
      }
    }
  } finally {
    activeProcessingPolls.delete(projectId);
  }
}

function rememberProject(
  set: (partial: Partial<ProjectState> | ((state: ProjectState) => Partial<ProjectState>)) => void,
  project: Project,
  extra?: Partial<ProjectState>,
): void {
  setCached(swrKeys.project(project.id), project);
  set((state) => ({
    project,
    projectsById: { ...state.projectsById, [project.id]: project },
    projectPlan: project.project_plan ?? null,
    ...extra,
  }));
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectsById: {},
  projectAccessErrors: {},
  evidenceDocs: [],
  projectMaterials: [],
  materialsProjectId: null,
  driveLinkedFiles: [],
  projectPlan: null,
  loading: false,
  generating: false,
  projectPlanLoading: false,
  error: null,
  draftMessage: null,
  setDraftMessage: (msg) => set({ draftMessage: msg }),

  loadProject: async (id: string) => {
    // A prior permanent failure for this exact id means "no access" — do not
    // keep hammering the API on every re-render/rehydrate effect.
    if (get().projectAccessErrors[id]) return;

    const requestId = ++latestLoadProjectRequest;
    const cached =
      get().projectsById[id]
      ?? getCached<Project>(swrKeys.project(id))
      ?? null;
    if (cached) {
      set({
        project: cached,
        projectsById: { ...get().projectsById, [id]: cached },
        projectPlan: cached.project_plan ?? get().projectPlan,
        loading: false,
        error: null,
      });
    } else {
      set({ loading: true, error: null });
    }
    try {
      const project = await withRequestTimeout(
        api.getProject(id),
        'Project took too long to load. Please refresh and try again.',
      );
      if (requestId !== latestLoadProjectRequest) return;
      const { [id]: _cleared, ...remainingErrors } = get().projectAccessErrors;
      rememberProject(set, project, { loading: false, error: null, projectAccessErrors: remainingErrors });
    } catch (error) {
      if (requestId !== latestLoadProjectRequest) return;
      const status = error instanceof ApiError ? error.status : null;
      const message = error instanceof Error ? error.message : 'Failed to load project';
      // 404 (not found) and 403 (no access) are permanent for this account —
      // record them so callers can show a real error instead of retrying
      // forever. Anything else (network blip, 5xx) stays transient/retryable.
      if (status === 404 || status === 403) {
        set((state) => ({
          projectAccessErrors: { ...state.projectAccessErrors, [id]: { status, message } },
          error: message,
          loading: false,
        }));
      } else {
        // Keep warm cache painted; only surface error on cold miss.
        set({ error: message, loading: false });
      }
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
    const cached = getCached<ProjectMaterial[]>(swrKeys.materials(id));
    if (cached) {
      set({ projectMaterials: cached, materialsProjectId: id });
    }

    const existing = loadMaterialsInflight.get(id);
    if (existing) {
      await existing;
      return;
    }

    const promise = (async () => {
      try {
        const projectMaterials = await api.getMaterials(id);
        setCached(swrKeys.materials(id), projectMaterials);
        set({ projectMaterials, materialsProjectId: id });
      } catch (error) {
        console.error('Failed to load materials:', error);
      } finally {
        loadMaterialsInflight.delete(id);
      }
    })();
    loadMaterialsInflight.set(id, promise);
    await promise;
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
      set((state) => {
        const projectMaterials = [asMaterial, ...state.projectMaterials];
        setCached(swrKeys.materials(id), projectMaterials);
        return {
          projectMaterials,
          materialsProjectId: id,
          evidenceDocs: [doc, ...state.evidenceDocs],
        };
      });
      schedulePollForProcessing(id, get, set);
      notifyProjectSignalsUpdated(id);
    } catch (error) {
      console.error('Failed to upload material:', error);
      throw error;
    }
  },

  uploadChatAttachment: async (id: string, file: File) => {
    const response = await api.uploadProjectMaterial(id, file);
    const material = response.material;
    set((state) => {
      const projectMaterials = [
        material,
        ...state.projectMaterials.filter((m) => m.id !== material.id),
      ];
      setCached(swrKeys.materials(id), projectMaterials);
      return { projectMaterials, materialsProjectId: id };
    });
    notifyProjectSignalsUpdated(id);
    return material;
  },

  deleteMaterial: async (materialId: string, source?: string | null) => {
    const prev = get().projectMaterials;
    const materialsProjectId = get().materialsProjectId;
    const mat = prev.find((m) => m.id === materialId);
    const isEvidence = source === 'evidence' || mat?.source === 'evidence';

    set((state) => {
      const projectMaterials = state.projectMaterials.filter((m) => m.id !== materialId);
      if (state.materialsProjectId) {
        setCached(swrKeys.materials(state.materialsProjectId), projectMaterials);
      }
      return { projectMaterials };
    });
    try {
      if (isEvidence) {
        await api.deleteEvidence(materialId);
        set((state) => ({
          evidenceDocs: state.evidenceDocs.filter((d) => d.id !== materialId),
        }));
      } else {
        await api.deleteMaterial(materialId);
      }
      notifyProjectSignalsUpdated(materialsProjectId);
    } catch (error) {
      set({ projectMaterials: prev, materialsProjectId });
      if (materialsProjectId) setCached(swrKeys.materials(materialsProjectId), prev);
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
      set((state) => {
        const projectMaterials = [...newMaterials, ...state.projectMaterials];
        setCached(swrKeys.materials(id), projectMaterials);
        return {
          projectMaterials,
          materialsProjectId: id,
          driveLinkedFiles: links,
        };
      });
      notifyProjectSignalsUpdated(id);
    }
    return result;
  },

  syncDriveFiles: async (id: string) => {
    const result = await api.syncDriveFiles(id);
    if (result.updated > 0) {
      const projectMaterials = await api.getMaterials(id);
      setCached(swrKeys.materials(id), projectMaterials);
      set({ projectMaterials, materialsProjectId: id });
      notifyProjectSignalsUpdated(id);
    }
    return result;
  },

  confirmIntake: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.confirmProject(id);
      const project = await api.getProject(id);
      rememberProject(set, project, { loading: false });
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

      set((state) => {
        const projectMaterials = [
          asMaterial,
          ...state.projectMaterials.filter((m) => m.id !== doc.id),
        ];
        setCached(swrKeys.materials(id), projectMaterials);
        return {
          evidenceDocs: [doc, ...state.evidenceDocs.filter((d) => d.id !== doc.id)],
          projectMaterials,
          materialsProjectId: id,
          loading: false,
          error: null,
        };
      });

      schedulePollForProcessing(id, get, set);
      notifyProjectSignalsUpdated(id);
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
      rememberProject(set, project, { loading: false });
      notifyProjectSignalsUpdated(id);
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
      notifyProjectSignalsUpdated(project?.id ?? get().materialsProjectId);
    } catch (error) {
      console.error('Failed to delete evidence:', error);
      set({ loading: false, error: null });
      throw error;
    }
  },

  selectTools: async (id: string, toolIds: string[]) => {
    set({ loading: true, error: null });
    try {
      const response = await api.selectTools(id, toolIds);
      set((state) => {
        if (!state.project || state.project.id !== id) {
          return { loading: false };
        }
        const project = {
          ...state.project,
          selected_tools: response.selected_tools,
          stage: response.stage,
        };
        setCached(swrKeys.project(id), project);
        return {
          project,
          projectsById: { ...state.projectsById, [id]: project },
          loading: false,
        };
      });
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
    rememberProject(set, project, {
      projectPlan: project.project_plan ?? get().projectPlan,
    });
    return project;
  },

  updateTitle: async (id: string, title: string) => {
    try {
      const project = await api.updateProject(id, { title });
      rememberProject(set, project);
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
      // Keep projectsById warm across soft resets so titles don't flash.
      evidenceDocs: [],
      projectMaterials: [],
      materialsProjectId: null,
      driveLinkedFiles: [],
      projectPlan: null,
      loading: false,
      generating: false,
      projectPlanLoading: false,
      error: null,
    });
  },
}));

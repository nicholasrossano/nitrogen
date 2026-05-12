import { create } from 'zustand';
import { api, Initiative, ChatMessage, StageStatus, MemoContent, EvidenceDoc, ProjectPlan, ProjectMaterial, DriveImportResult, DriveSyncResult, DriveLinkedFile, FieldContext } from '@/lib/api';

interface MessageVariantEntry {
  versions: ChatMessage[];
  currentIndex: number;
}

interface InitiativeState {
  initiative: Initiative | null;
  messages: ChatMessage[];
  stageStatus: StageStatus | null;
  memo: MemoContent | null;
  memoId: string | null;
  evidenceDocs: EvidenceDoc[];
  projectMaterials: ProjectMaterial[];
  driveLinkedFiles: DriveLinkedFile[];
  projectPlan: ProjectPlan | null;

  loading: boolean;
  sending: boolean;
  generating: boolean;
  projectPlanLoading: boolean;
  error: string | null;
  streamingMessageId: string | null;

  messageFeedback: Record<string, 'like' | 'dislike' | null>;
  messageVariants: Record<string, MessageVariantEntry>;
  retryingMessageId: string | null;

  draftMessage: string | null;
  setDraftMessage: (msg: string | null) => void;

  loadInitiative: (id: string) => Promise<void>;
  loadChatHistory: (id: string) => Promise<void>;
  loadEvidence: (id: string) => Promise<void>;
  loadMaterials: (id: string) => Promise<void>;
  uploadMaterial: (id: string, file: File) => Promise<void>;
  deleteMaterial: (materialId: string) => Promise<void>;
  loadDriveLinkedFiles: (id: string) => Promise<void>;
  importFromDrive: (id: string, fileIds: string[]) => Promise<DriveImportResult>;
  syncDriveFiles: (id: string) => Promise<DriveSyncResult>;
  /**
   * @deprecated Legacy chat state path kept temporarily for compatibility.
   * Active project chat surfaces use ProjectChatSurface + api.sendChatStream.
   */
  sendMessage: (id: string, content: string, toolHint?: string, fieldContext?: FieldContext | null) => Promise<void>;
  /**
   * @deprecated Legacy chat state path kept temporarily for compatibility.
   */
  editMessage: (id: string, messageId: string, newContent: string) => Promise<void>;
  /**
   * @deprecated Legacy chat state path kept temporarily for compatibility.
   */
  retryMessage: (id: string, messageId: string) => Promise<void>;
  setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => void;
  setVariantIndex: (originalMessageId: string, index: number) => void;
  confirmIntake: (id: string) => Promise<void>;
  uploadEvidence: (id: string, file: File) => Promise<void>;
  pasteEvidence: (id: string, content: string, title?: string) => Promise<void>;
  deleteEvidence: (evidenceId: string) => Promise<void>;
  generateMemo: (id: string, includeCorpus?: boolean) => Promise<void>;
  exportMemo: (id: string) => Promise<void>;
  selectTools: (id: string, toolIds: string[]) => Promise<void>;
  generateAllDeliverables: (id: string) => Promise<void>;
  generateInitiativeOverview: (id: string) => Promise<Initiative>;
  updateTitle: (id: string, title: string) => Promise<void>;
  _refreshPlanInBackground: (id: string) => Promise<void>;
  loadProjectPlan: (id: string) => Promise<void>;
  generateProjectPlan: (id: string) => Promise<void>;
  updateMessageWidgetData: (messageId: string, widgetData: Record<string, any>) => void;
  updatePlanItemStatus: (id: string, itemId: string, status: 'not_started' | 'in_progress' | 'complete') => Promise<void>;
  deletePlanItem: (id: string, itemId: string) => Promise<void>;
  addPlanItem: (id: string, pillarId: string, title: string, itemType?: 'deliverable' | 'assessment', phaseId?: string) => Promise<void>;
  reset: () => void;
}

let latestLoadInitiativeRequest = 0;

function withRequestTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

// Poll evidence/material lists while uploads process; cheap list calls, one loop per initiative.
const activeProcessingPolls = new Set<string>();

async function schedulePollForProcessing(
  initiativeId: string,
  get: () => InitiativeState,
  set: (partial: Partial<InitiativeState> | ((state: InitiativeState) => Partial<InitiativeState>)) => void,
): Promise<void> {
  if (activeProcessingPolls.has(initiativeId)) return;
  activeProcessingPolls.add(initiativeId);

  const POLL_INTERVAL_MS = 1500;
  const MAX_POLLS = 80; // ~2 minutes of polling, then give up

  try {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      let evidenceDocs: EvidenceDoc[];
      try {
        evidenceDocs = await api.getEvidence(initiativeId);
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
        // Refresh initiative so evidence_ready and related flags match the server.
        try {
          const initiative = await api.getInitiative(initiativeId);
          set({ initiative });
          get()._refreshPlanInBackground(initiativeId);
        } catch {
          // ignore refresh errors when polling stops
        }
        return;
      }
    }
  } finally {
    activeProcessingPolls.delete(initiativeId);
  }
}


export const useInitiativeStore = create<InitiativeState>((set, get) => ({
  initiative: null,
  messages: [],
  stageStatus: null,
  memo: null,
  memoId: null,
  evidenceDocs: [],
  projectMaterials: [],
  driveLinkedFiles: [],
  projectPlan: null,
  loading: false,
  sending: false,
  generating: false,
  projectPlanLoading: false,
  error: null,
  streamingMessageId: null,
  messageFeedback: {},
  messageVariants: {},
  retryingMessageId: null,
  draftMessage: null,
  setDraftMessage: (msg) => set({ draftMessage: msg }),

  loadInitiative: async (id: string) => {
    const requestId = ++latestLoadInitiativeRequest;
    set({ loading: true, error: null });
    try {
      const initiative = await withRequestTimeout(
        api.getInitiative(id),
        'Project took too long to load. Please refresh and try again.',
      );
      if (requestId !== latestLoadInitiativeRequest) return;
      set({
        initiative,
        loading: false,
        // Keep projectPlan aligned with initiative payload so switching projects cannot leak stale plan state.
        projectPlan: initiative.project_plan ?? null,
      });
    } catch (error) {
      if (requestId !== latestLoadInitiativeRequest) return;
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load initiative',
        loading: false 
      });
    }
  },

  loadChatHistory: async (id: string) => {
    try {
      const response = await api.getChatHistory(id);
      const messages = response?.messages || [];
      const stage_status = response?.stage_status;
      const feedbackMap: Record<string, 'like' | 'dislike' | null> = {};
      for (const msg of messages) {
        if (msg.feedback) {
          feedbackMap[msg.id] = msg.feedback as 'like' | 'dislike';
        }
      }
      set({ messages, stageStatus: stage_status, messageFeedback: feedbackMap });
    } catch (error) {
      console.error('Failed to load chat history:', error);
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

  // Uploads go through evidence indexing so materials and corpus stay consistent.
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
      set(state => ({
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
    const mat = prev.find(m => m.id === materialId);
    const isEvidence = mat?.source === 'evidence';

    set(state => ({
      projectMaterials: state.projectMaterials.filter(m => m.id !== materialId),
    }));
    try {
      if (isEvidence) {
        await api.deleteEvidence(materialId);
        set(state => ({
          evidenceDocs: state.evidenceDocs.filter(d => d.id !== materialId),
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

  sendMessage: async (id: string, content: string, toolHint?: string, fieldContext?: FieldContext | null) => {
    const { messages } = get();

    set({
      sending: true,
      error: null,
      streamingMessageId: null,
    });

    const userMessage: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content,
      widget_type: null,
      widget_data: null,
      created_at: new Date().toISOString(),
    };
    
    const currentMessages = messages || [];
    set({ 
      messages: [...currentMessages, userMessage],
    });

    const streamingMessageId = `streaming-${Date.now()}`;
    const streamingMessage: ChatMessage = {
      id: streamingMessageId,
      role: 'assistant',
      content: '',
      widget_type: null,
      widget_data: null,
      created_at: new Date().toISOString(),
    };

    try {

      set(state => ({
        messages: [...state.messages, streamingMessage],
        streamingMessageId: streamingMessageId,
      }));
      
      const words: string[] = [];
      let wordFlushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushWords = () => {
        wordFlushTimer = null;
        const joined = words.join(' ');
        set(state => ({
          messages: state.messages.map(m =>
            m.id === streamingMessageId ? { ...m, content: joined } : m
          ),
        }));
      };

      await api.sendMessageStream(
        id,
        content,
        (word: string) => {
          words.push(word);
          if (!wordFlushTimer) wordFlushTimer = setTimeout(flushWords, 80);
        },
        async (message: ChatMessage, stageStatus: any) => {
          if (wordFlushTimer) { clearTimeout(wordFlushTimer); wordFlushTimer = null; }
          set({
            streamingMessageId: null,
            sending: false,
            stageStatus,
          });

          const initiative = await api.getInitiative(id);
          set({ initiative });

          if (initiative.project_plan) {
            set({ projectPlan: initiative.project_plan });
          }

          const chatHistory = await api.getChatHistory(id);
          const finalMessages = chatHistory?.messages || [];
          set({ messages: finalMessages });
        },
        toolHint,
        fieldContext,
      );
    } catch (error) {
      console.error('sendMessage: error', error);
      set(state => ({
        messages: state.messages.filter(m => m.id !== userMessage.id && m.id !== streamingMessageId),
        error: error instanceof Error ? error.message : 'Failed to send message',
        sending: false,
        streamingMessageId: null,
      }));
    }
  },

  editMessage: async (id: string, messageId: string, newContent: string) => {
    set({ sending: true, error: null });
    try {
      await api.truncateChatFrom(id, messageId);
      await get().sendMessage(id, newContent);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to edit message',
        sending: false,
      });
    }
  },

  retryMessage: async (id: string, messageId: string) => {
    set({ retryingMessageId: messageId, error: null });
    try {
      // Retries use the latest DB id from messageVariants while the list keeps the stable UI id.
      const { messageVariants } = get();
      const existing = messageVariants[messageId];
      const realDbId = existing
        ? existing.versions[existing.currentIndex].id
        : messageId;

      const response = await api.retryAssistantMessage(id, realDbId);
      const newMessage = response.message;

      set(state => {
        const stableMessage = { ...newMessage, id: messageId };
        const updatedMessages = state.messages.map(m =>
          m.id === messageId ? stableMessage : m
        );

        const prevEntry = state.messageVariants[messageId];
        const originalMsg = state.messages.find(m => m.id === messageId);
        const prevVersions = prevEntry ? prevEntry.versions : (originalMsg ? [originalMsg] : []);
        const versions = [...prevVersions, newMessage];

        return {
          messages: updatedMessages,
          stageStatus: response.stage_status,
          retryingMessageId: null,
          messageVariants: {
            ...state.messageVariants,
            [messageId]: { versions, currentIndex: versions.length - 1 },
          },
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to retry message',
        retryingMessageId: null,
      });
    }
  },

  setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => {
    const prev = get().messageFeedback[messageId] ?? null;
    set(state => ({
      messageFeedback: { ...state.messageFeedback, [messageId]: feedback },
    }));
    const initiative = get().initiative;
    if (initiative) {
      api.setMessageFeedback(initiative.id, messageId, feedback).catch(() => {
        set(state => ({
          messageFeedback: { ...state.messageFeedback, [messageId]: prev },
        }));
      });
    }
  },

  setVariantIndex: (originalMessageId: string, index: number) => {
    set(state => {
      const entry = state.messageVariants[originalMessageId];
      if (!entry) return state;
      const clampedIndex = Math.max(0, Math.min(index, entry.versions.length - 1));
      const selectedVariant = entry.versions[clampedIndex];
      const stableMessage = { ...selectedVariant, id: originalMessageId };
      const updatedMessages = state.messages.map(m =>
        m.id === originalMessageId ? stableMessage : m
      );
      return {
        messages: updatedMessages,
        messageVariants: {
          ...state.messageVariants,
          [originalMessageId]: { ...entry, currentIndex: clampedIndex },
        },
      };
    });
  },

  confirmIntake: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.confirmInitiative(id);

      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      
      set({ 
        initiative,
        messages,
        stageStatus: stage_status,
        loading: false,
      });
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

      // Show the new doc immediately; avoid awaiting full initiative/chat reload (upload returns before indexing finishes).
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

      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        loading: false,
      });
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
      const updatedDocs = evidenceDocs.filter(doc => doc.id !== evidenceId);
      
      set({
        evidenceDocs: updatedDocs,
        loading: false,
      });

      const initiative = get().initiative;
      if (initiative) get()._refreshPlanInBackground(initiative.id);
    } catch (error) {
      console.error('Failed to delete evidence:', error);
      set({
        loading: false,
        error: null, // Don't show persistent error for delete failures
      });
      throw error;
    }
  },

  generateMemo: async (id: string, includeCorpus: boolean = true) => {
    set({ generating: true, error: null });
    try {
      const response = await api.generateMemo(id, includeCorpus);

      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        memo: response.content,
        memoId: response.id,
        generating: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to generate',
        generating: false,
      });
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

      // Optimistic only: fast handoff to framework view; plan/chat refresh happens on the next focused fetch.
      set((state) => ({
        initiative: state.initiative
          ? {
              ...state.initiative,
              selected_tools: response.selected_tools,
              stage: response.stage,
            }
          : state.initiative,
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

  generateAllDeliverables: async (id: string) => {
    set({ generating: true, error: null });
    try {
      await api.generateAllDeliverables(id);

      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        generating: false,
      });

      get()._refreshPlanInBackground(id);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to generate deliverables',
        generating: false,
      });
    }
  },

  generateInitiativeOverview: async (id: string) => {
    const initiative = await api.generateInitiativeOverview(id);
    set((state) => ({
      initiative,
      projectPlan: initiative.project_plan ?? state.projectPlan,
    }));
    return initiative;
  },

  updateTitle: async (id: string, title: string) => {
    try {
      const initiative = await api.updateInitiative(id, { title });
      set({ initiative });
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  },

  /** Background refresh when a plan already exists (keeps UI responsive). */
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

  /** In-memory widget_data only; persistence is the caller's responsibility. */
  updateMessageWidgetData: (messageId: string, widgetData: Record<string, any>) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, widget_data: widgetData } : m
      ),
    }));
  },

  updatePlanItemStatus: async (id: string, itemId: string, status: 'not_started' | 'in_progress' | 'complete') => {
    const { projectPlan } = get();
    if (!projectPlan) return;

    const updatedPillars = projectPlan.pillars.map(pillar => ({
      ...pillar,
      items: pillar.items.map(item =>
        item.id === itemId ? { ...item, status } : item
      ),
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

    const updatedPillars = projectPlan.pillars.map(pillar => ({
      ...pillar,
      items: pillar.items.filter(item => item.id !== itemId),
    }));
    set({ projectPlan: { ...projectPlan, pillars: updatedPillars } });

    try {
      await api.deletePlanItem(id, itemId);
    } catch (error) {
      set({ projectPlan });
      console.error('Failed to delete plan item:', error);
    }
  },

  addPlanItem: async (id: string, pillarId: string, title: string, itemType: 'deliverable' | 'assessment' = 'deliverable', phaseId?: string) => {
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
      p.id === pillarId ? { ...p, items: [...p.items, newItem] } : p
    );
    set({ projectPlan: { ...projectPlan, pillars: updatedPillars } });

    try {
      const result = await api.addPlanItem(id, pillarId, title, itemType, phaseId);
      const currentPlan = get().projectPlan;
      if (!currentPlan) return;
      const finalPillars = currentPlan.pillars.map((p) =>
        p.id === pillarId
          ? { ...p, items: p.items.map((i) => (i.id === tempId ? result.item : i)) }
          : p
      );
      set({ projectPlan: { ...currentPlan, pillars: finalPillars } });
    } catch (error) {
      const currentPlan = get().projectPlan;
      if (!currentPlan) return;
      const rollbackPillars = currentPlan.pillars.map((p) =>
        p.id === pillarId ? { ...p, items: p.items.filter((i) => i.id !== tempId) } : p
      );
      set({ projectPlan: { ...currentPlan, pillars: rollbackPillars } });
      console.error('Failed to add plan item:', error);
    }
  },

  reset: () => {
    set({
      initiative: null,
      messages: [],
      stageStatus: null,
      memo: null,
      memoId: null,
      evidenceDocs: [],
      projectMaterials: [],
      driveLinkedFiles: [],
      projectPlan: null,
      loading: false,
      sending: false,
      generating: false,
      projectPlanLoading: false,
      error: null,
      streamingMessageId: null,
      messageFeedback: {},
      messageVariants: {},
      retryingMessageId: null,
    });
  },
}));

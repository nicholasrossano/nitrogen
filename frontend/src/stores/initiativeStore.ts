import { create } from 'zustand';
import { api, Initiative, ChatMessage, StageStatus, MemoContent, EvidenceDoc, ProjectPlan, ProjectMaterial, DriveImportResult, DriveSyncResult, DriveLinkedFile, FieldContext } from '@/lib/api';

interface MessageVariantEntry {
  versions: ChatMessage[];
  currentIndex: number;
}

interface InitiativeState {
  // Data
  initiative: Initiative | null;
  messages: ChatMessage[];
  stageStatus: StageStatus | null;
  memo: MemoContent | null;
  memoId: string | null;
  evidenceDocs: EvidenceDoc[];
  projectMaterials: ProjectMaterial[];
  driveLinkedFiles: DriveLinkedFile[];
  projectPlan: ProjectPlan | null;

  // UI State
  loading: boolean;
  sending: boolean;
  generating: boolean;
  projectPlanLoading: boolean;
  error: string | null;
  streamingMessageId: string | null;

  // Message toolbar state
  messageFeedback: Record<string, 'like' | 'dislike' | null>;
  messageVariants: Record<string, MessageVariantEntry>;
  retryingMessageId: string | null;

  // Chat input draft (pre-fill without sending)
  draftMessage: string | null;
  setDraftMessage: (msg: string | null) => void;
  
  // Actions
  loadInitiative: (id: string) => Promise<void>;
  loadChatHistory: (id: string) => Promise<void>;
  loadEvidence: (id: string) => Promise<void>;
  loadMaterials: (id: string) => Promise<void>;
  uploadMaterial: (id: string, file: File) => Promise<void>;
  deleteMaterial: (materialId: string) => Promise<void>;
  loadDriveLinkedFiles: (id: string) => Promise<void>;
  importFromDrive: (id: string, fileIds: string[]) => Promise<DriveImportResult>;
  syncDriveFiles: (id: string) => Promise<DriveSyncResult>;
  sendMessage: (id: string, content: string, toolHint?: string, fieldContext?: FieldContext | null) => Promise<void>;
  editMessage: (id: string, messageId: string, newContent: string) => Promise<void>;
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

export const useInitiativeStore = create<InitiativeState>((set, get) => ({
  // Initial state
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

  // Load initiative details (also populates projectPlan from the response)
  loadInitiative: async (id: string) => {
    const requestId = ++latestLoadInitiativeRequest;
    set({ loading: true, error: null });
    try {
      const initiative = await api.getInitiative(id);
      if (requestId !== latestLoadInitiativeRequest) return;
      set({
        initiative,
        loading: false,
        // Always sync projectPlan so stale plan state from another project cannot persist.
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

  // Load chat history
  loadChatHistory: async (id: string) => {
    try {
      const response = await api.getChatHistory(id);
      const messages = response?.messages || [];
      const stage_status = response?.stage_status;
      // Hydrate feedback map from persisted message data
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

  // Load evidence documents
  loadEvidence: async (id: string) => {
    try {
      const evidenceDocs = await api.getEvidence(id);
      set({ evidenceDocs });
    } catch (error) {
      console.error('Failed to load evidence:', error);
    }
  },

  // Load project materials
  loadMaterials: async (id: string) => {
    try {
      const projectMaterials = await api.getMaterials(id);
      set({ projectMaterials });
    } catch (error) {
      console.error('Failed to load materials:', error);
    }
  },

  // Upload project material — routes through evidence so all files get semantic indexing
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
      };
      set(state => ({
        projectMaterials: [asMaterial, ...state.projectMaterials],
        evidenceDocs: [doc, ...state.evidenceDocs],
      }));
    } catch (error) {
      console.error('Failed to upload material:', error);
      throw error;
    }
  },

  // Delete project material (or evidence doc if source === 'evidence')
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

  // Load Drive-linked file records for this initiative
  loadDriveLinkedFiles: async (id: string) => {
    try {
      const links = await api.getDriveLinkedFiles(id);
      set({ driveLinkedFiles: links });
    } catch (error) {
      console.error('Failed to load Drive linked files:', error);
    }
  },

  // Import files from Google Drive and add them to the materials list
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
      // Reload linked files to reflect the new links
      const links = await api.getDriveLinkedFiles(id);
      set((state) => ({
        projectMaterials: [...newMaterials, ...state.projectMaterials],
        driveLinkedFiles: links,
      }));
    }
    return result;
  },

  // Check Drive-linked files for changes and re-index updated ones
  syncDriveFiles: async (id: string) => {
    const result = await api.syncDriveFiles(id);
    if (result.updated > 0) {
      // Reload materials so updated file sizes/dates are reflected
      const projectMaterials = await api.getMaterials(id);
      set({ projectMaterials });
    }
    return result;
  },

  // Send a message with streaming
  sendMessage: async (id: string, content: string, toolHint?: string, fieldContext?: FieldContext | null) => {
    const { messages } = get();
    
    // Set sending state first
    set({ 
      sending: true,
      error: null,
      streamingMessageId: null,
    });
    
    // Optimistic update - add user message immediately
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

    // Create a placeholder assistant message for streaming
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
      
      // Add the streaming message and mark it as streaming
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

          // Sync the project plan from the initiative (covers both initial generation and chat-driven updates)
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
      // Remove optimistic updates on error
      set(state => ({
        messages: state.messages.filter(m => m.id !== userMessage.id && m.id !== streamingMessageId),
        error: error instanceof Error ? error.message : 'Failed to send message',
        sending: false,
        streamingMessageId: null,
      }));
    }
  },

  // Edit a user message: truncate from that message and re-send with new content
  editMessage: async (id: string, messageId: string, newContent: string) => {
    set({ sending: true, error: null });
    try {
      await api.truncateChatFrom(id, messageId);
      // sendMessage will handle the rest (optimistic UI, streaming, reload)
      await get().sendMessage(id, newContent);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to edit message',
        sending: false,
      });
    }
  },

  // Retry an assistant message: delete it and regenerate
  retryMessage: async (id: string, messageId: string) => {
    set({ retryingMessageId: messageId, error: null });
    try {
      // Resolve the real DB ID in case this message has already been retried
      // (the display keeps the original stable ID but the variant entry tracks real IDs)
      const { messageVariants } = get();
      const existing = messageVariants[messageId];
      const realDbId = existing
        ? existing.versions[existing.currentIndex].id
        : messageId;

      const response = await api.retryAssistantMessage(id, realDbId);
      const newMessage = response.message;

      set(state => {
        // Keep the original message ID stable in the flat list so variant lookups stay consistent
        const stableMessage = { ...newMessage, id: messageId };
        const updatedMessages = state.messages.map(m =>
          m.id === messageId ? stableMessage : m
        );

        // Track variants: seed with original message if first retry
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

  // Toggle like/dislike feedback for a message (optimistic + persist)
  setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => {
    const prev = get().messageFeedback[messageId] ?? null;
    set(state => ({
      messageFeedback: { ...state.messageFeedback, [messageId]: feedback },
    }));
    const initiative = get().initiative;
    if (initiative) {
      api.setMessageFeedback(initiative.id, messageId, feedback).catch(() => {
        // Revert on failure
        set(state => ({
          messageFeedback: { ...state.messageFeedback, [messageId]: prev },
        }));
      });
    }
  },

  // Navigate between retry variants
  setVariantIndex: (originalMessageId: string, index: number) => {
    set(state => {
      const entry = state.messageVariants[originalMessageId];
      if (!entry) return state;
      const clampedIndex = Math.max(0, Math.min(index, entry.versions.length - 1));
      // Keep the stable display ID while swapping content to the selected variant
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

  // Confirm intake
  confirmIntake: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.confirmInitiative(id);
      
      // Reload everything
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

  // Upload evidence file (used by EvidenceInputWidget / DocumentRequestWidget)
  uploadEvidence: async (id: string, file: File) => {
    set({ loading: true, error: null });
    try {
      const response = await api.uploadEvidence(id, file);

      // Reload initiative context (needed so AI sees the new evidence)
      const [initiative, { messages, stage_status }, evidenceDocs] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
        api.getEvidence(id),
      ]);

      // Also surface the new file in projectMaterials so the Files tab updates immediately
      const doc: EvidenceDoc = response.document;
      const asMaterial: ProjectMaterial = {
        id: doc.id,
        filename: doc.filename ?? file.name,
        file_type: doc.file_type ?? '',
        file_size: doc.file_size ?? file.size,
        created_at: doc.created_at,
        source: 'evidence',
      };

      set((state) => ({
        initiative,
        messages,
        stageStatus: stage_status,
        evidenceDocs,
        projectMaterials: [asMaterial, ...state.projectMaterials.filter((m) => m.id !== doc.id)],
        loading: false,
        error: null,
      }));

      get()._refreshPlanInBackground(id);
    } catch (error) {
      console.error('Failed to upload evidence:', error);
      set({ loading: false, error: null });
      throw error;
    }
  },

  // Paste evidence text
  pasteEvidence: async (id: string, content: string, title?: string) => {
    set({ loading: true, error: null });
    try {
      await api.pasteEvidence(id, content, title);
      
      // Reload
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

  // Delete evidence document
  deleteEvidence: async (evidenceId: string) => {
    set({ loading: true, error: null });
    try {
      await api.deleteEvidence(evidenceId);
      
      // Reload evidence list
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

  // Generate memo
  generateMemo: async (id: string, includeCorpus: boolean = true) => {
    set({ generating: true, error: null });
    try {
      const response = await api.generateMemo(id, includeCorpus);
      
      // Reload chat to get memo viewer message
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

  // Export memo
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

  // Select tools for initiative
  selectTools: async (id: string, toolIds: string[]) => {
    set({ loading: true, error: null });
    try {
      await api.selectTools(id, toolIds);
      
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
      console.error('selectTools: error', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to select tools',
        loading: false,
      });
    }
  },

  // Generate all deliverables
  generateAllDeliverables: async (id: string) => {
    set({ generating: true, error: null });
    try {
      await api.generateAllDeliverables(id);
      
      // Reload everything
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

  // Update initiative title
  updateTitle: async (id: string, title: string) => {
    try {
      const initiative = await api.updateInitiative(id, { title });
      set({ initiative });
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  },

  // Silently refresh the project plan in the background (if one already exists)
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

  // Load project plan (keeps stale data visible until fresh data arrives)
  loadProjectPlan: async (id: string) => {
    try {
      const response = await api.getProjectPlan(id);
      set({ projectPlan: response.project_plan });
    } catch (error) {
      console.error('Failed to load project plan:', error);
    }
  },

  // Generate (or refresh) project plan
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

  // Update widget_data on a message in-memory (no API call — caller handles persistence)
  updateMessageWidgetData: (messageId: string, widgetData: Record<string, any>) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, widget_data: widgetData } : m
      ),
    }));
  },

  // Update a single plan item status (optimistic)
  updatePlanItemStatus: async (id: string, itemId: string, status: 'not_started' | 'in_progress' | 'complete') => {
    const { projectPlan } = get();
    if (!projectPlan) return;

    // Optimistic update
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
      // Revert on failure
      set({ projectPlan });
      console.error('Failed to update plan item status:', error);
    }
  },

  // Delete a single plan item (optimistic)
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

  // Add a new item to a pillar (optimistic); optionally assign to a phase
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

  // Reset state
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

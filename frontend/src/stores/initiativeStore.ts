import { create } from 'zustand';
import { api, Initiative, ChatMessage, StageStatus, MemoContent, EvidenceDoc, ToolAlignment, AlignmentSection, AlignmentParameter, ProjectPlan, ProposedCategory, ProjectMaterial } from '@/lib/api';

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
  projectPlan: ProjectPlan | null;
  
  // UI State
  loading: boolean;
  sending: boolean;
  generating: boolean;
  alignmentLoading: boolean;
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
  sendMessage: (id: string, content: string, toolHint?: string) => Promise<void>;
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
  updateTitle: (id: string, title: string) => Promise<void>;
  confirmAlignment: (id: string, toolId: string, sections?: AlignmentSection[], parameters?: AlignmentParameter[]) => Promise<void>;
  provideFeedback: (id: string, toolId: string, feedback: string) => Promise<void>;
  _refreshPlanInBackground: (id: string) => Promise<void>;
  loadProjectPlan: (id: string) => Promise<void>;
  generateProjectPlan: (id: string) => Promise<void>;
  confirmPlanCategories: (id: string, categories: ProposedCategory[]) => Promise<void>;
  updatePlanItemStatus: (id: string, itemId: string, status: 'not_started' | 'in_progress' | 'complete') => Promise<void>;
  deletePlanItem: (id: string, itemId: string) => Promise<void>;
  reset: () => void;
}

export const useInitiativeStore = create<InitiativeState>((set, get) => ({
  // Initial state
  initiative: null,
  messages: [],
  stageStatus: null,
  memo: null,
  memoId: null,
  evidenceDocs: [],
  projectMaterials: [],
  projectPlan: null,
  loading: false,
  sending: false,
  generating: false,
  alignmentLoading: false,
  projectPlanLoading: false,
  error: null,
  streamingMessageId: null,
  messageFeedback: {},
  messageVariants: {},
  retryingMessageId: null,
  draftMessage: null,
  setDraftMessage: (msg) => set({ draftMessage: msg }),

  // Load initiative details
  loadInitiative: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const initiative = await api.getInitiative(id);
      set({ initiative, loading: false });
    } catch (error) {
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
      console.log('loadChatHistory: response', response);
      const messages = response?.messages || [];
      const stage_status = response?.stage_status;
      console.log('loadChatHistory: setting messages', { count: messages.length });
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

  // Upload project material
  uploadMaterial: async (id: string, file: File) => {
    try {
      const response = await api.uploadMaterial(id, file);
      set(state => ({
        projectMaterials: [response.material, ...state.projectMaterials],
      }));
    } catch (error) {
      console.error('Failed to upload material:', error);
      throw error;
    }
  },

  // Delete project material
  deleteMaterial: async (materialId: string) => {
    const prev = get().projectMaterials;
    set(state => ({
      projectMaterials: state.projectMaterials.filter(m => m.id !== materialId),
    }));
    try {
      await api.deleteMaterial(materialId);
    } catch (error) {
      set({ projectMaterials: prev });
      console.error('Failed to delete material:', error);
      throw error;
    }
  },

  // Send a message with streaming
  sendMessage: async (id: string, content: string, toolHint?: string) => {
    const { messages } = get();
    console.log('sendMessage: starting', { id, content, currentMessageCount: messages?.length });
    
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
    console.log('sendMessage: optimistic update done', { newCount: currentMessages.length + 1 });

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
      console.log('sendMessage: calling streaming API');
      
      // Add the streaming message and mark it as streaming
      set(state => ({
        messages: [...state.messages, streamingMessage],
        streamingMessageId: streamingMessageId,
      }));
      
      const words: string[] = [];
      
      await api.sendMessageStream(
        id,
        content,
        // onWord
        (word: string) => {
          words.push(word);
          
          set(state => {
            const updatedMessages = state.messages.map(m =>
              m.id === streamingMessageId
                ? { ...m, content: words.join(' ') }
                : m
            );
            return { messages: updatedMessages };
          });
        },
        // onComplete
        async (message: ChatMessage, stageStatus: any) => {
          console.log('sendMessage: stream complete');
          
          // Clear streaming state
          set({ 
            streamingMessageId: null,
            sending: false,
            stageStatus,
          });

          // Reload initiative to get updated fields
          console.log('sendMessage: reloading initiative');
          const initiative = await api.getInitiative(id);
          set({ initiative });

          // Sync the project plan from the initiative (covers both initial generation and chat-driven updates)
          if (initiative.project_plan) {
            set({ projectPlan: initiative.project_plan });
          }

          // Reload chat history to get any additional messages the backend added
          console.log('sendMessage: reloading chat history');
          const chatHistory = await api.getChatHistory(id);
          const finalMessages = chatHistory?.messages || [];
          console.log('sendMessage: setting final messages', { count: finalMessages.length });
          set({ messages: finalMessages });
        },
        toolHint,
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

  // Upload evidence file
  uploadEvidence: async (id: string, file: File) => {
    set({ loading: true, error: null });
    try {
      await api.uploadEvidence(id, file);
      
      // Reload
      const [initiative, { messages, stage_status }, evidenceDocs] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
        api.getEvidence(id),
      ]);
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        evidenceDocs,
        loading: false,
        error: null,
      });

      get()._refreshPlanInBackground(id);
    } catch (error) {
      console.error('Failed to upload evidence:', error);
      // Don't persist upload errors - just log them and clear loading state
      set({
        loading: false,
        error: null,
      });
      // Re-throw so the UI can handle it with a toast or inline message
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
    console.log('selectTools: starting', { id, toolIds });
    set({ loading: true, error: null });
    try {
      console.log('selectTools: calling API');
      await api.selectTools(id, toolIds);
      console.log('selectTools: API returned successfully');
      
      // Reload everything
      console.log('selectTools: reloading data');
      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      console.log('selectTools: data reloaded', { 
        initiative: !!initiative, 
        messageCount: messages?.length,
        lastMessage: messages?.[messages.length - 1]
      });
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        loading: false,
      });
      console.log('selectTools: state updated');
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

  // Update initiative title
  updateTitle: async (id: string, title: string) => {
    try {
      const initiative = await api.updateInitiative(id, { title });
      set({ initiative });
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  },

  // Confirm alignment for a tool
  confirmAlignment: async (id: string, toolId: string, sections?: AlignmentSection[], parameters?: AlignmentParameter[]) => {
    set({ alignmentLoading: true, error: null });
    try {
      await api.confirmAlignment(id, toolId, sections, parameters);
      
      // Reload everything to get next alignment or deliverables overview
      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        alignmentLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to confirm alignment',
        alignmentLoading: false,
      });
    }
  },

  // Provide feedback on alignment
  provideFeedback: async (id: string, toolId: string, feedback: string) => {
    set({ alignmentLoading: true, error: null });
    try {
      await api.provideFeedback(id, toolId, feedback);
      
      // Reload chat to get updated alignment widget
      const [initiative, { messages, stage_status }] = await Promise.all([
        api.getInitiative(id),
        api.getChatHistory(id),
      ]);
      
      set({
        initiative,
        messages,
        stageStatus: stage_status,
        alignmentLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to provide feedback',
        alignmentLoading: false,
      });
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

  // Load project plan
  loadProjectPlan: async (id: string) => {
    set({ projectPlan: null });
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

  // Confirm proposed categories and generate the full plan
  confirmPlanCategories: async (id: string, categories: ProposedCategory[]) => {
    set({ projectPlanLoading: true, error: null });
    try {
      const response = await api.confirmPlanCategories(id, categories);
      const initiative = await api.getInitiative(id);
      set({
        projectPlan: response.project_plan,
        initiative,
        projectPlanLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to generate project plan',
        projectPlanLoading: false,
      });
    }
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
      projectPlan: null,
      loading: false,
      sending: false,
      generating: false,
      alignmentLoading: false,
      projectPlanLoading: false,
      error: null,
      streamingMessageId: null,
      messageFeedback: {},
      messageVariants: {},
      retryingMessageId: null,
    });
  },
}));

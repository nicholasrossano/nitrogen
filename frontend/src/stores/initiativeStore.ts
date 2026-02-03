import { create } from 'zustand';
import { api, Initiative, ChatMessage, StageStatus, MemoContent, EvidenceDoc, ToolAlignment, AlignmentSection, AlignmentParameter } from '@/lib/api';

interface InitiativeState {
  // Data
  initiative: Initiative | null;
  messages: ChatMessage[];
  stageStatus: StageStatus | null;
  memo: MemoContent | null;
  memoId: string | null;
  evidenceDocs: EvidenceDoc[];
  
  // UI State
  loading: boolean;
  sending: boolean;
  generating: boolean;
  alignmentLoading: boolean;
  error: string | null;
  streamingMessageId: string | null;
  
  // Actions
  loadInitiative: (id: string) => Promise<void>;
  loadChatHistory: (id: string) => Promise<void>;
  loadEvidence: (id: string) => Promise<void>;
  sendMessage: (id: string, content: string) => Promise<void>;
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
  loading: false,
  sending: false,
  generating: false,
  alignmentLoading: false,
  error: null,
  streamingMessageId: null,

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
      set({ messages, stageStatus: stage_status });
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

  // Send a message with streaming
  sendMessage: async (id: string, content: string) => {
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
          
          // Reload chat history to get any additional messages the backend added
          console.log('sendMessage: reloading chat history');
          const chatHistory = await api.getChatHistory(id);
          const finalMessages = chatHistory?.messages || [];
          console.log('sendMessage: setting final messages', { count: finalMessages.length });
          set({ messages: finalMessages });
        }
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

  // Reset state
  reset: () => {
    set({
      initiative: null,
      messages: [],
      stageStatus: null,
      memo: null,
      memoId: null,
      evidenceDocs: [],
      loading: false,
      sending: false,
      generating: false,
      alignmentLoading: false,
      error: null,
      streamingMessageId: null,
    });
  },
}));

import { create } from 'zustand';
import { api, Initiative, ChatMessage, StageStatus, MemoContent, EvidenceDoc } from '@/lib/api';

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
  error: string | null;
  
  // Actions
  loadInitiative: (id: string) => Promise<void>;
  loadChatHistory: (id: string) => Promise<void>;
  loadEvidence: (id: string) => Promise<void>;
  sendMessage: (id: string, content: string) => Promise<void>;
  confirmIntake: (id: string) => Promise<void>;
  uploadEvidence: (id: string, file: File) => Promise<void>;
  pasteEvidence: (id: string, content: string, title?: string) => Promise<void>;
  generateMemo: (id: string, includeCorpus?: boolean) => Promise<void>;
  exportMemo: (id: string) => Promise<void>;
  selectTools: (id: string, toolIds: string[]) => Promise<void>;
  generateAllDeliverables: (id: string) => Promise<void>;
  updateTitle: (id: string, title: string) => Promise<void>;
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
  error: null,

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
      const { messages, stage_status } = await api.getChatHistory(id);
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

  // Send a message
  sendMessage: async (id: string, content: string) => {
    const { messages } = get();
    
    // Set sending state first
    set({ 
      sending: true,
      error: null,
    });
    
    // Optimistic update - add user message immediately
    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      widget_type: null,
      widget_data: null,
      created_at: new Date().toISOString(),
    };
    
    set({ 
      messages: [...messages, userMessage],
    });

    try {
      console.log('Starting API call, sending state should be true');
      const response = await api.sendMessage(id, content);
      console.log('API call completed');
      
      // Replace temp message with real one and add assistant response
      set(state => ({
        messages: [
          ...state.messages.filter(m => m.id !== userMessage.id),
          { ...userMessage, id: `user-${Date.now()}` },
          response.message,
        ],
        stageStatus: response.stage_status,
        sending: false,
      }));

      // Reload initiative to get updated fields
      const initiative = await api.getInitiative(id);
      set({ initiative });
      
      // Reload chat history to get any additional messages the backend added
      const chatHistory = await api.getChatHistory(id);
      set({ messages: chatHistory.messages });
    } catch (error) {
      // Remove optimistic update on error
      set(state => ({
        messages: state.messages.filter(m => m.id !== userMessage.id),
        error: error instanceof Error ? error.message : 'Failed to send message',
        sending: false,
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
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to upload',
        loading: false,
      });
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
      api.downloadExport(response.export_id);
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
      error: null,
    });
  },
}));

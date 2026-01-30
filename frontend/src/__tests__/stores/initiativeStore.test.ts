import { act, renderHook } from '@testing-library/react';

// Mock the API module
jest.mock('@/lib/api', () => ({
  api: {
    getInitiative: jest.fn(),
    getChatHistory: jest.fn(),
    sendMessage: jest.fn(),
    confirmInitiative: jest.fn(),
    uploadEvidence: jest.fn(),
    pasteEvidence: jest.fn(),
    generateMemo: jest.fn(),
    exportMemo: jest.fn(),
    downloadExport: jest.fn(),
    selectTools: jest.fn(),
    generateAllDeliverables: jest.fn(),
  },
}));

// Import after mocking
import { useInitiativeStore } from '@/stores/initiativeStore';
import { api } from '@/lib/api';

describe('useInitiativeStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    const { result } = renderHook(() => useInitiativeStore());
    act(() => {
      result.current.reset();
    });
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { result } = renderHook(() => useInitiativeStore());
      
      expect(result.current.initiative).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.stageStatus).toBeNull();
      expect(result.current.memo).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.sending).toBe(false);
      expect(result.current.generating).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('loadInitiative', () => {
    it('sets loading state while fetching', async () => {
      const mockInitiative = { id: '1', title: 'Test' };
      (api.getInitiative as jest.Mock).mockResolvedValue(mockInitiative);
      
      const { result } = renderHook(() => useInitiativeStore());
      
      // Start loading
      let loadPromise: Promise<void>;
      act(() => {
        loadPromise = result.current.loadInitiative('1');
      });
      
      expect(result.current.loading).toBe(true);
      
      // Wait for completion
      await act(async () => {
        await loadPromise;
      });
      
      expect(result.current.loading).toBe(false);
      expect(result.current.initiative).toEqual(mockInitiative);
    });

    it('sets error on failure', async () => {
      (api.getInitiative as jest.Mock).mockRejectedValue(new Error('Not found'));
      
      const { result } = renderHook(() => useInitiativeStore());
      
      await act(async () => {
        await result.current.loadInitiative('1');
      });
      
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Not found');
    });
  });

  describe('loadChatHistory', () => {
    it('loads messages and stage status', async () => {
      const mockHistory = {
        messages: [{ id: '1', role: 'assistant', content: 'Hello' }],
        stage_status: { stage: 'intake', stage_1_complete: false },
      };
      (api.getChatHistory as jest.Mock).mockResolvedValue(mockHistory);
      
      const { result } = renderHook(() => useInitiativeStore());
      
      await act(async () => {
        await result.current.loadChatHistory('1');
      });
      
      expect(result.current.messages).toEqual(mockHistory.messages);
      expect(result.current.stageStatus).toEqual(mockHistory.stage_status);
    });
  });

  describe('sendMessage', () => {
    it('adds optimistic user message', async () => {
      const mockResponse = {
        message: { id: '2', role: 'assistant', content: 'Response' },
        stage_status: { stage: 'intake' },
      };
      const mockInitiative = { id: '1', title: 'Test' };
      
      (api.sendMessage as jest.Mock).mockResolvedValue(mockResponse);
      (api.getInitiative as jest.Mock).mockResolvedValue(mockInitiative);
      
      const { result } = renderHook(() => useInitiativeStore());
      
      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('1', 'Hello');
      });
      
      // Should have optimistic message
      expect(result.current.sending).toBe(true);
      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Hello');
      expect(result.current.messages[0].role).toBe('user');
      
      await act(async () => {
        await sendPromise;
      });
      
      expect(result.current.sending).toBe(false);
    });

    it('removes optimistic message on error', async () => {
      (api.sendMessage as jest.Mock).mockRejectedValue(new Error('Failed'));
      
      const { result } = renderHook(() => useInitiativeStore());
      
      await act(async () => {
        await result.current.sendMessage('1', 'Hello');
      });
      
      expect(result.current.messages).toEqual([]);
      expect(result.current.error).toBe('Failed');
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', async () => {
      const mockInitiative = { id: '1', title: 'Test' };
      (api.getInitiative as jest.Mock).mockResolvedValue(mockInitiative);
      
      const { result } = renderHook(() => useInitiativeStore());
      
      // Load some data
      await act(async () => {
        await result.current.loadInitiative('1');
      });
      
      expect(result.current.initiative).not.toBeNull();
      
      // Reset
      act(() => {
        result.current.reset();
      });
      
      expect(result.current.initiative).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });
});

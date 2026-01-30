/**
 * Tests for API client utilities
 */

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// We need to import the api module dynamically to work with mocked fetch
describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('fetchApi', () => {
    it('makes GET requests correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', title: 'Test' }),
      });

      // Import fresh to get clean module
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      const result = await api.getInitiative('test-id');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/test-id'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual({ id: '1', title: 'Test' });
    });

    it('makes POST requests correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', title: 'New Initiative' }),
      });

      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.createInitiative('New Initiative');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'New Initiative' }),
        })
      );
    });

    it('handles HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Not found' }),
      });

      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await expect(api.getInitiative('bad-id')).rejects.toThrow('Not found');
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await expect(api.getInitiative('test-id')).rejects.toThrow('Network error');
    });

    it('handles malformed error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      // When JSON parsing fails, the API returns 'Unknown error' from the catch block
      await expect(api.getInitiative('test-id')).rejects.toThrow('Unknown error');
    });
  });

  describe('API endpoints', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    it('createInitiative calls correct endpoint', async () => {
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.createInitiative('Test');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('getChatHistory calls correct endpoint', async () => {
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.getChatHistory('init-123');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/init-123/chat'),
        expect.any(Object)
      );
    });

    it('sendMessage calls correct endpoint with content', async () => {
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.sendMessage('init-123', 'Hello');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/init-123/chat'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello' }),
        })
      );
    });

    it('confirmInitiative calls correct endpoint', async () => {
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.confirmInitiative('init-123');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/init-123/confirm'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('selectTools calls correct endpoint with tool IDs', async () => {
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.selectTools('init-123', ['tool1', 'tool2']);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/init-123/select-tools'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ tool_ids: ['tool1', 'tool2'] }),
        })
      );
    });

    it('generateMemo calls correct endpoint with options', async () => {
      jest.resetModules();
      const { api } = await import('@/lib/api');
      
      await api.generateMemo('init-123', false);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/init-123/generate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ include_corpus: false }),
        })
      );
    });
  });
});

describe('Type definitions', () => {
  it('Initiative interface has required fields', () => {
    // TypeScript compile-time check - if this compiles, types are correct
    const initiative: import('@/lib/api').Initiative = {
      id: '1',
      user_id: 'user-1',
      title: 'Test',
      sector: 'education',
      geography: null,
      target_population: null,
      goal: null,
      budget_range: null,
      timeline: null,
      constraints: null,
      stage: 'describe',
      stage_1_complete: false,
      evidence_ready: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      project_description: null,
      project_type: null,
      selected_tools: null,
      tool_inputs: null,
      deliverables: null,
    };
    
    expect(initiative.id).toBe('1');
  });

  it('ChatMessage interface has required fields', () => {
    const message: import('@/lib/api').ChatMessage = {
      id: '1',
      role: 'assistant',
      content: 'Hello',
      widget_type: null,
      widget_data: null,
      created_at: '2024-01-01',
    };
    
    expect(message.role).toBe('assistant');
  });

  it('StageStatus interface has required fields', () => {
    const status: import('@/lib/api').StageStatus = {
      stage: 'describe',
      stage_1_complete: false,
      evidence_ready: false,
      required_fields_complete: true,
      missing_fields: [],
    };
    
    expect(status.stage).toBe('describe');
  });
});

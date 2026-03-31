/**
 * Tests for the API client layer.
 * Firebase auth is mocked in jest.setup.js; firebase/auth dynamic import is mocked here.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock firebase/auth dynamic import used by getAuthToken
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
}));

jest.mock('@/lib/firebase', () => ({
  app: {},
}));

function mockOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockError(status: number, detail: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ detail }),
    text: () => Promise.resolve(JSON.stringify({ detail })),
  };
}

describe('api', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.resetModules();
  });

  describe('getInitiative', () => {
    it('calls the correct URL', async () => {
      mockFetch.mockResolvedValueOnce(mockOk({ id: '1', title: 'Test' }));
      const { api } = await import('@/lib/api');
      await api.getInitiative('1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/1'),
        expect.any(Object),
      );
    });

    it('returns the parsed response body', async () => {
      mockFetch.mockResolvedValueOnce(mockOk({ id: '1', title: 'Test' }));
      const { api } = await import('@/lib/api');
      const result = await api.getInitiative('1');
      expect(result).toEqual({ id: '1', title: 'Test' });
    });

    it('throws with the server detail on non-2xx', async () => {
      mockFetch.mockResolvedValueOnce(mockError(404, 'Not found'));
      const { api } = await import('@/lib/api');
      await expect(api.getInitiative('bad-id')).rejects.toThrow('Not found');
    });
  });

  describe('createInitiative', () => {
    it('posts to the initiatives endpoint', async () => {
      mockFetch.mockResolvedValueOnce(mockOk({ id: '2', title: 'New' }));
      const { api } = await import('@/lib/api');
      await api.createInitiative('New Initiative');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('getChatHistory', () => {
    it('calls the chat history endpoint', async () => {
      mockFetch.mockResolvedValueOnce(mockOk([]));
      const { api } = await import('@/lib/api');
      await api.getChatHistory('init-1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/initiatives/init-1/chat'),
        expect.any(Object),
      );
    });
  });
});

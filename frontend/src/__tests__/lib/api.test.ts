/**
 * Tests for the API client layer.
 * Firebase auth is mocked in jest.setup.js; firebase/auth dynamic import is mocked here.
 */

import { TextDecoder, TextEncoder } from 'util';

global.TextEncoder = TextEncoder as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

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

function mockSseResponse(events: unknown[]) {
  const encoded = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  );

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: encoded };
          },
        };
      },
    },
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
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

  describe('sendChatStream', () => {
    it('includes field and model input context in the request body', async () => {
      mockFetch.mockResolvedValueOnce(mockSseResponse([
        {
          type: 'complete',
          content: 'Done',
          sources: [],
          tiers_used: [],
          citation_count: 0,
          latency_ms: 0,
          widget_type: 'proposed_value',
          widget_data: { field_name: 'capacity_factor', proposed_value: 0.42 },
          chat_id: 'chat-1',
          user_message_id: 'user-1',
          assistant_message_id: 'assistant-1',
        },
      ]));

      const { api } = await import('@/lib/api');
      await api.sendChatStream(
        [],
        'Investigate capacity factor',
        jest.fn(),
        jest.fn(),
        jest.fn(),
        jest.fn(),
        null,
        null,
        {
          field_name: 'capacity_factor',
          label: 'Capacity factor',
          current_value: 0.3,
          unit: '%',
          model_type: 'lcoe',
          status: 'assumed',
        },
        '### LCOE Model Inputs\n- Capacity factor (field_name=capacity_factor): 0.3 % [assumed]',
        'initiative-1',
      );

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);

      expect(body.field_context).toEqual(
        expect.objectContaining({ field_name: 'capacity_factor', model_type: 'lcoe' }),
      );
      expect(body.model_inputs_context).toContain('capacity_factor');
      expect(body.initiative_id).toBe('initiative-1');
    });
  });
});

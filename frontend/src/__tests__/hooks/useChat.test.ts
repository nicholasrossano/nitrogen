import { renderHook, act } from '@testing-library/react';
import { useChat } from '@/hooks/useChat';

const mockSendMessage = jest.fn();
const mockMessages = [
  {
    id: '1',
    role: 'assistant' as const,
    content: 'Hello!',
    widget_type: null,
    widget_data: null,
    created_at: '2024-01-01T00:00:00Z',
  },
];

jest.mock('@/stores/initiativeStore', () => ({
  useInitiativeStore: () => ({
    messages: mockMessages,
    sending: false,
    sendMessage: mockSendMessage,
  }),
}));

describe('useChat', () => {
  const initiativeId = 'test-initiative-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns messages from the store', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    expect(result.current.messages).toEqual(mockMessages);
  });

  it('returns sending state from the store', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    expect(result.current.sending).toBe(false);
  });

  it('exposes a sendMessage function', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    expect(typeof result.current.sendMessage).toBe('function');
  });

  it('calls store sendMessage with initiativeId and content', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    act(() => {
      result.current.sendMessage('Hello');
    });
    expect(mockSendMessage).toHaveBeenCalledWith(initiativeId, 'Hello');
  });

  it('memoizes sendMessage between renders', () => {
    const { result, rerender } = renderHook(() => useChat(initiativeId));
    const first = result.current.sendMessage;
    rerender();
    expect(result.current.sendMessage).toBe(first);
  });
});

import { renderHook, act } from '@testing-library/react';
import { useChat } from '@/hooks/useChat';

// Mock the initiative store
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

  it('returns messages from store', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    
    expect(result.current.messages).toEqual(mockMessages);
  });

  it('returns sending state from store', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    
    expect(result.current.sending).toBe(false);
  });

  it('provides sendMessage function', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    
    expect(typeof result.current.sendMessage).toBe('function');
  });

  it('calls store sendMessage with correct arguments', () => {
    const { result } = renderHook(() => useChat(initiativeId));
    
    result.current.sendMessage('Test message');
    
    expect(mockSendMessage).toHaveBeenCalledWith(initiativeId, 'Test message');
  });

  it('memoizes sendMessage callback', () => {
    const { result, rerender } = renderHook(() => useChat(initiativeId));
    
    const firstCallback = result.current.sendMessage;
    rerender();
    const secondCallback = result.current.sendMessage;
    
    expect(firstCallback).toBe(secondCallback);
  });
});

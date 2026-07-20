import {
  DEMO_PLACEHOLDER_REPLY,
  DEMO_PLACEHOLDER_SOURCES,
  DEMO_PLACEHOLDER_WIDGET,
  streamDemoPlaceholderReply,
} from '@/lib/demo/demoPlaceholderReply';

describe('streamDemoPlaceholderReply', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('streams a showcase reply with citations and a proposed-value widget', async () => {
    const onThinking = jest.fn();
    const onWord = jest.fn();
    const onComplete = jest.fn();

    const done = streamDemoPlaceholderReply({
      chatId: null,
      onThinking,
      onWord,
      onComplete,
    });

    await jest.runAllTimersAsync();
    await done;

    expect(onThinking).toHaveBeenCalled();
    expect(onWord.mock.calls.length).toBeGreaterThan(10);
    expect(DEMO_PLACEHOLDER_REPLY).not.toMatch(/[—–]/);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: DEMO_PLACEHOLDER_REPLY,
        chat_id: '',
        sources: DEMO_PLACEHOLDER_SOURCES,
        citation_count: DEMO_PLACEHOLDER_SOURCES.length,
        tiers_used: ['evidence', 'worldbank_project'],
        widget_type: 'proposed_value',
        widget_data: DEMO_PLACEHOLDER_WIDGET,
      }),
    );
    expect(DEMO_PLACEHOLDER_REPLY).toContain('[Evidence: Rift Valley Solar Feasibility Study v3]');
    expect(DEMO_PLACEHOLDER_REPLY).toContain(
      '[Comparable Project: Kenya Green and Resilient Expansion of Energy (GREEN) Program Phase 2 Project]',
    );
    expect(
      DEMO_PLACEHOLDER_SOURCES.some(
        (s) =>
          s.source_type === 'worldbank_project'
          && s.source_url?.includes('P180465'),
      ),
    ).toBe(true);
  });

  it('reuses the existing chat id so URL sync does not reload fixtures', async () => {
    const onComplete = jest.fn();

    const done = streamDemoPlaceholderReply({
      chatId: 'demo-chat-lcoe-sensitivity',
      onThinking: jest.fn(),
      onWord: jest.fn(),
      onComplete,
    });

    await jest.runAllTimersAsync();
    await done;

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'demo-chat-lcoe-sensitivity',
        content: DEMO_PLACEHOLDER_REPLY,
        widget_type: 'proposed_value',
      }),
    );
  });
});

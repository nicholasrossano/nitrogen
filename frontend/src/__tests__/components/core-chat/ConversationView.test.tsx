import { act, fireEvent, render, screen } from '@testing-library/react';

import { ConversationView } from '@/components/core-chat/ConversationView';

jest.mock('react-markdown', () => ({
  __esAssessment: true,
  default: ({ children }: { children: unknown }) => <div>{children as any}</div>,
}));
jest.mock('remark-math', () => ({ __esAssessment: true, default: jest.fn() }));
jest.mock('rehype-katex', () => ({ __esAssessment: true, default: jest.fn() }));

describe('ConversationView', () => {
  it('forwards draft field context and model inputs context on send', () => {
    const onSendMessage = jest.fn();

    render(
      <ConversationView
        messages={[]}
        sending={false}
        thinkingLines={[]}
        researchSteps={[]}
        streamingContent=""
        error={null}
        onSendMessage={onSendMessage}
        onEditMessage={jest.fn()}
        onRetryMessage={jest.fn()}
        messageFeedback={{}}
        onSetFeedback={jest.fn()}
        retryingMessageId={null}
        initiativeId="initiative-1"
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('nitrogen:draft', {
        detail: {
          text: 'Investigate capacity factor',
          label: 'Capacity factor',
          fieldContext: {
            field_name: 'capacity_factor',
            label: 'Capacity factor',
            current_value: 0.3,
            unit: '%',
            model_type: 'lcoe',
            status: 'assumed',
          },
          modelInputsContext: '### LCOE Model Inputs\n- Capacity factor (field_name=capacity_factor): 0.3 % [assumed]',
        },
      }));
    });

    const textarea = screen.getByPlaceholderText('Ask anything');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSendMessage).toHaveBeenCalledWith(
      'Investigate capacity factor',
      undefined,
      expect.objectContaining({
        field_name: 'capacity_factor',
        model_type: 'lcoe',
      }),
      expect.stringContaining('capacity_factor'),
    );
  });
});

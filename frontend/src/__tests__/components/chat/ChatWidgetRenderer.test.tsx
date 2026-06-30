import React from 'react';
import { render } from '@testing-library/react';
import { ChatWidgetRenderer } from '@/components/chat/ChatWidgetRenderer';

const confirmationSpy = jest.fn();
const deliverablesSpy = jest.fn();

jest.mock('@/components/widgets/ConfirmationWidget', () => ({
  ConfirmationWidget: (props: Record<string, unknown>) => {
    confirmationSpy(props);
    return <div data-testid="confirmation-widget" />;
  },
}));

jest.mock('@/components/widgets/DeliverablesOverviewWidget', () => ({
  DeliverablesOverviewWidget: (props: Record<string, unknown>) => {
    deliverablesSpy(props);
    return <div data-testid="deliverables-widget" />;
  },
}));

describe('ChatWidgetRenderer', () => {
  beforeEach(() => {
    confirmationSpy.mockClear();
    deliverablesSpy.mockClear();
  });

  it('passes onSendMessage into confirmation widgets', () => {
    const onSendMessage = jest.fn();
    render(
      <ChatWidgetRenderer
        type="confirmation"
        data={{}}
        projectId="initiative-1"
        onSendMessage={onSendMessage}
      />,
    );

    expect(confirmationSpy).toHaveBeenCalledWith(expect.objectContaining({
      onSendMessage,
    }));
  });

  it('passes onSendMessage into deliverables widgets', () => {
    const onSendMessage = jest.fn();
    render(
      <ChatWidgetRenderer
        type="deliverables_overview"
        data={{}}
        projectId="initiative-1"
        onSendMessage={onSendMessage}
      />,
    );

    expect(deliverablesSpy).toHaveBeenCalledWith(expect.objectContaining({
      onSendMessage,
    }));
  });
});

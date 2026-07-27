import React from 'react';
import { render } from '@testing-library/react';
import { ChatWidgetRenderer } from '@/components/chat/ChatWidgetRenderer';

const confirmationSpy = jest.fn();
const deliverablesSpy = jest.fn();
const checklistSpy = jest.fn();

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

jest.mock('@/components/widgets/AssessmentChecklistWidget', () => ({
  AssessmentChecklistWidget: (props: Record<string, unknown>) => {
    checklistSpy(props);
    return <div data-testid="assessment-checklist-widget" />;
  },
}));

describe('ChatWidgetRenderer', () => {
  beforeEach(() => {
    confirmationSpy.mockClear();
    deliverablesSpy.mockClear();
    checklistSpy.mockClear();
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

  it('passes onStartAssessment into framework plan widgets', () => {
    const onStartAssessment = jest.fn();
    render(
      <ChatWidgetRenderer
        type="tool_checklist"
        data={{}}
        projectId="initiative-1"
        onStartAssessment={onStartAssessment}
      />,
    );

    expect(checklistSpy).toHaveBeenCalledWith(expect.objectContaining({
      onStartAssessment,
    }));
  });
});

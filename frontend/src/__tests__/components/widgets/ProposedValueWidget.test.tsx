import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ProposedValueWidget } from '@/components/widgets/ProposedValueWidget';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    updateMessageWidget: jest.fn(),
  },
}));

describe('ProposedValueWidget', () => {
  beforeEach(() => {
    jest.mocked(api.updateMessageWidget).mockReset();
  });

  it('does not render the unitless placeholder as visible text', () => {
    render(
      <ProposedValueWidget
        data={{
          field_name: 'discount_rate',
          label: 'Discount Rate (WACC)',
          unit: 'unitless',
          proposed_value: 0.08,
          model_type: 'lcoe',
          confidence: 'moderate',
          explanation: 'Uses the best available regional proxy.',
        }}
      />,
    );

    expect(screen.getByText('0.08')).toBeInTheDocument();
    expect(screen.queryByText(/unitless/i)).not.toBeInTheDocument();
  });

  it('persists confirmed widget state before marking the value confirmed', async () => {
    jest.mocked(api.updateMessageWidget).mockResolvedValue({ message_id: 'message-1', updated: true });
    const confirmedListener = jest.fn();
    window.addEventListener('nitrogen:input-confirmed', confirmedListener);

    render(
      <ProposedValueWidget
        projectId="initiative-1"
        messageId="message-1"
        data={{
          field_name: 'discount_rate',
          label: 'Discount Rate (WACC)',
          unit: 'unitless',
          proposed_value: 0.08,
          model_type: 'lcoe',
          confidence: 'moderate',
          explanation: 'Uses the best available regional proxy.',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /accept & update model/i }));

    await waitFor(() => {
      expect(api.updateMessageWidget).toHaveBeenCalledWith(
        'initiative-1',
        'message-1',
        expect.objectContaining({ confirmed: true, dismissed: false }),
      );
      expect(screen.getByText('Value Confirmed')).toBeInTheDocument();
      expect(confirmedListener).toHaveBeenCalled();
    });

    window.removeEventListener('nitrogen:input-confirmed', confirmedListener);
  });

  it('uses the direct apply handler instead of the legacy event when provided', async () => {
    jest.mocked(api.updateMessageWidget).mockResolvedValue({ message_id: 'message-1', updated: true });
    const applyValue = jest.fn().mockResolvedValue(true);
    const confirmedListener = jest.fn();
    window.addEventListener('nitrogen:input-confirmed', confirmedListener);

    render(
      <ProposedValueWidget
        projectId="initiative-1"
        messageId="message-1"
        onApplyValue={applyValue}
        data={{
          field_name: 'discount_rate',
          label: 'Discount Rate (WACC)',
          unit: 'unitless',
          proposed_value: 0.08,
          model_type: 'lcoe',
          confidence: 'moderate',
          explanation: 'Uses the best available regional proxy.',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /accept & update model/i }));

    await waitFor(() => {
      expect(applyValue).toHaveBeenCalledWith({
        fieldName: 'discount_rate',
        value: 0.08,
        modelType: 'lcoe',
      });
      expect(api.updateMessageWidget).toHaveBeenCalled();
      expect(screen.getByText('Value Confirmed')).toBeInTheDocument();
    });
    expect(confirmedListener).not.toHaveBeenCalled();

    window.removeEventListener('nitrogen:input-confirmed', confirmedListener);
  });
});

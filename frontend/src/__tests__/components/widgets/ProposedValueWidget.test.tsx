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

  it('uses the direct apply handler and notifies the float without a second write', async () => {
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
    expect(confirmedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          field_name: 'discount_rate',
          value: 0.08,
          model_type: 'lcoe',
          already_persisted: true,
        }),
      }),
    );

    window.removeEventListener('nitrogen:input-confirmed', confirmedListener);
  });

  it('ignores repeated accept clicks while an apply is in flight', async () => {
    let resolveApply: (value: boolean) => void = () => undefined;
    const applyValue = jest.fn().mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveApply = resolve; }),
    );
    jest.mocked(api.updateMessageWidget).mockResolvedValue({ message_id: 'message-1', updated: true });

    render(
      <ProposedValueWidget
        projectId="initiative-1"
        messageId="message-1"
        onApplyValue={applyValue}
        data={{
          field_name: 'system_capacity_kw',
          label: 'System Capacity',
          unit: 'kW DC',
          proposed_value: 100,
          model_type: 'solar',
          confidence: 'high',
          explanation: 'Typical productive-use capacity.',
        }}
      />,
    );

    const button = screen.getByRole('button', { name: /accept & update model/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(applyValue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /updating/i })).toBeDisabled();

    resolveApply(true);
    await waitFor(() => {
      expect(screen.getByText('Value Confirmed')).toBeInTheDocument();
    });
  });
});

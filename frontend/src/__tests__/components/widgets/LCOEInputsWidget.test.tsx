import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LCOEInputsWidget } from '@/components/widgets/LCOEInputsWidget';
import { api } from '@/lib/api';

describe('LCOEInputsWidget', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('treats only validated values as confirmed', () => {
    render(
      <LCOEInputsWidget
        projectId="initiative-1"
        data={{
          inputs: {
            capacity_factor: {
              field_name: 'capacity_factor',
              label: 'Capacity factor',
              value: 0.32,
              unit: '%',
              source: 'user',
              status: 'validated',
              notes: '',
              rationale: '',
              category: 'energy',
            },
            wacc: {
              field_name: 'wacc',
              label: 'WACC',
              value: 0.08,
              unit: '%',
              source: 'assumption',
              status: 'assumed',
              notes: '',
              rationale: 'Fallback assumption',
              category: 'finance',
            },
          },
          missing_essentials: [],
        }}
      />,
    );

    const validatedCheckbox = screen.getByTitle('Mark as extracted') as HTMLInputElement;
    const assumedCheckbox = screen.getByTitle('Mark as validated') as HTMLInputElement;

    expect(validatedCheckbox.checked).toBe(true);
    expect(assumedCheckbox.checked).toBe(false);
  });

  it('opens assumption-scoped chat event for investigate', async () => {
    jest.spyOn(api, 'resolveAssumption').mockResolvedValueOnce({
      found: true,
      assumption: { id: 'assumption-1' } as any,
    });
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <LCOEInputsWidget
        projectId="initiative-1"
        data={{
          inputs: {
            capacity_factor: {
              field_name: 'capacity_factor',
              label: 'Capacity factor',
              value: 0.32,
              unit: '%',
              source: 'assumption',
              status: 'assumed',
              notes: '',
              rationale: '',
              category: 'energy',
            },
          },
          missing_essentials: [],
        }}
      />,
    );

    const label = screen.getByText('Capacity factor');
    fireEvent.mouseEnter(label);
    // Tooltip uses pointer-events-none; real clicks pass through to the row. Click the label so the row onClick runs.
    fireEvent.click(label);

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nitrogen:open-assumption-chat',
        }),
      );
    });
  });
});

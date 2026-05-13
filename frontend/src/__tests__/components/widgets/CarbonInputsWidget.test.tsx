import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CarbonInputsWidget } from '@/components/widgets/CarbonInputsWidget';
import { api } from '@/lib/api';

describe('CarbonInputsWidget', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('treats only validated values as confirmed', () => {
    render(
      <CarbonInputsWidget
        initiativeId="initiative-1"
        data={{
          inputs: {
            baseline_volume: {
              field_name: 'baseline_volume',
              label: 'Baseline volume',
              value: 1200,
              unit: 'tCO2e',
              source: 'user',
              status: 'validated',
              applies_to: 'baseline',
              notes: '',
              rationale: '',
              category: 'baseline',
            },
            project_volume: {
              field_name: 'project_volume',
              label: 'Project volume',
              value: 700,
              unit: 'tCO2e',
              source: 'chat',
              status: 'extracted',
              applies_to: 'project',
              notes: '',
              rationale: '',
              category: 'project',
            },
          },
          missing_essentials: [],
        }}
      />,
    );

    const validatedCheckbox = screen.getByTitle('Mark as extracted') as HTMLInputElement;
    const inferredCheckbox = screen.getByTitle('Mark as validated') as HTMLInputElement;

    expect(validatedCheckbox.checked).toBe(true);
    expect(inferredCheckbox.checked).toBe(false);
  });

  it('opens assumption-scoped chat event for investigate', async () => {
    jest.spyOn(api, 'resolveAssumption').mockResolvedValueOnce({
      found: true,
      assumption: { id: 'assumption-2' } as any,
    });
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <CarbonInputsWidget
        initiativeId="initiative-1"
        data={{
          inputs: {
            baseline_volume: {
              field_name: 'baseline_volume',
              label: 'Baseline volume',
              value: 1200,
              unit: 'tCO2e',
              source: 'assumption',
              status: 'assumed',
              applies_to: 'baseline',
              notes: '',
              rationale: '',
              category: 'baseline',
            },
          },
          missing_essentials: [],
        }}
      />,
    );

    const label = screen.getByText('Baseline volume');
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

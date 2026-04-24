import { render, screen } from '@testing-library/react';

import { CarbonInputsWidget } from '@/components/widgets/CarbonInputsWidget';

describe('CarbonInputsWidget', () => {
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
              status: 'inferred',
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

    const validatedCheckbox = screen.getByTitle('Mark as inferred') as HTMLInputElement;
    const inferredCheckbox = screen.getByTitle('Mark as validated') as HTMLInputElement;

    expect(validatedCheckbox.checked).toBe(true);
    expect(inferredCheckbox.checked).toBe(false);
  });
});

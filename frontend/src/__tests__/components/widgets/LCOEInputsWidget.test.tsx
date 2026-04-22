import { render, screen } from '@testing-library/react';

import { LCOEInputsWidget } from '@/components/widgets/LCOEInputsWidget';

describe('LCOEInputsWidget', () => {
  it('treats only validated values as confirmed', () => {
    render(
      <LCOEInputsWidget
        initiativeId="initiative-1"
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

    const validatedCheckbox = screen.getByTitle('Mark as inferred') as HTMLInputElement;
    const assumedCheckbox = screen.getByTitle('Mark as validated') as HTMLInputElement;

    expect(validatedCheckbox.checked).toBe(true);
    expect(assumedCheckbox.checked).toBe(false);
  });
});

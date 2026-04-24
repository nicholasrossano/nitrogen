import { render, screen } from '@testing-library/react';

import { ProposedValueWidget } from '@/components/widgets/ProposedValueWidget';

describe('ProposedValueWidget', () => {
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
});

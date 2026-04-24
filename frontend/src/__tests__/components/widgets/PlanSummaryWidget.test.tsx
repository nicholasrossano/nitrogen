import React from 'react';
import { render, screen } from '@testing-library/react';

import type { PlanWorkspaceSummaryData } from '@/components/plan-workspace';
import { PlanSummaryWidget } from '@/components/widgets/PlanSummaryWidget';

describe('PlanSummaryWidget', () => {
  it('renders generic group summaries without project-plan-specific labels', () => {
    const data: PlanWorkspaceSummaryData = {
      planType: 'procurement_plan',
      title: 'Procurement Plan',
      subtitle: '9 tasks across 3 workstreams',
      footerText: 'You can edit this as needed in the diagram directly.',
      totalItems: 9,
      groups: [
        { id: 'sourcing', name: 'Sourcing', itemCount: 4, requiredCount: 2, icon: 'Target' },
        { id: 'vendors', name: 'Vendor Review', itemCount: 3, requiredCount: 1, icon: 'Users' },
        { id: 'award', name: 'Award', itemCount: 2, requiredCount: 0, icon: 'Award' },
      ],
    };

    render(<PlanSummaryWidget data={data} />);

    expect(screen.getByText('Procurement Plan')).toBeInTheDocument();
    expect(screen.getByText('9 tasks across 3 workstreams')).toBeInTheDocument();
    expect(screen.getByText('Sourcing')).toBeInTheDocument();
    expect(screen.getByText('Vendor Review')).toBeInTheDocument();
    expect(screen.getByText('Award')).toBeInTheDocument();
    expect(screen.getByText('4 items · 2 required')).toBeInTheDocument();
    expect(screen.getByText('You can edit this as needed in the diagram directly.')).toBeInTheDocument();
  });
});

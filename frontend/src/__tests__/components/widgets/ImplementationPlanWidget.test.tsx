import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ImplementationPlanWidget } from '@/components/widgets/ImplementationPlanWidget';

jest.mock('@/components/plan-workspace', () => ({
  PlanWorkspaceView: ({ groups, onOpenItem }: { groups: any[]; onOpenItem: (item: any, group: any) => void }) => (
    <button
      type="button"
      onClick={() => onOpenItem(groups[0].items[0], groups[0])}
    >
      Open first item
    </button>
  ),
}));

describe('ImplementationPlanWidget', () => {
  it('emits inspector state focused on overview content', async () => {
    const onInspectorStateChange = jest.fn();

    render(
      <ImplementationPlanWidget
        projectId="initiative-1"
        data={{
          groups: [
            {
              id: 'group-1',
              label: 'Implementation',
              color: '#00aa66',
              items: [
                {
                  id: 'item-1',
                  name: 'Install controls',
                  description: 'Deploy control devices at key points.',
                  item_type: 'deliverable',
                  classification: 'required',
                  status: 'in_progress',
                  supports: ['monitoring'],
                  depends_on: ['site survey'],
                  provenance: {
                    sources: [{ title: 'Vendor spec', url: 'https://example.com/spec' }],
                  },
                },
              ],
            },
          ],
        }}
        onInspectorStateChange={onInspectorStateChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open first item' }));

    await waitFor(() => {
      expect(onInspectorStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            summaryTitle: 'Overview',
            summary: expect.arrayContaining([expect.stringContaining('Deploy control devices')]),
            requirements: [],
            dependencies: [],
          }),
        }),
      );
    });
  });
});

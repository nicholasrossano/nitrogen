import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EditableTableStage } from '@/components/assessments/stages/EditableTableStage';
import { api } from '@/lib/api';

const baseFields = [
  { name: 'variable', label: 'Variable', field_type: 'text' },
  { name: 'value', label: 'Value', field_type: 'number' },
  { name: 'unit', label: 'Unit', field_type: 'text' },
];

describe('EditableTableStage investigate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens assumption-scoped chat when investigate resolves an assumption', async () => {
    jest.spyOn(api, 'resolveAssumption').mockResolvedValueOnce({
      found: true,
      assumption: { id: 'assumption-1' } as any,
    });
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <EditableTableStage
        projectId="project-1"
        instanceId="instance-1"
        assessmentId="lcoe_model"
        stageId="inputs"
        fields={baseFields}
        items={[
          {
            id: 'item-1',
            origin: 'inferred',
            content: {
              variable: 'Capacity factor',
              field_name: 'capacity_factor',
              value: 0.32,
              unit: '%',
              status: 'assumed',
              category: 'energy',
            },
          },
        ]}
        allowAddRows={false}
        onChanged={jest.fn()}
      />,
    );

    const label = screen.getByText('Capacity factor');
    fireEvent.mouseEnter(label);
    fireEvent.click(label);

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nitrogen:open-assumption-chat',
        }),
      );
    });
  });

  it('dispatches draft investigate payload with field context when assumption creation fails', async () => {
    jest.spyOn(api, 'resolveAssumption').mockResolvedValueOnce({
      found: false,
      assumption: null,
    });
    jest.spyOn(api, 'createAssumption').mockRejectedValueOnce(new Error('forbidden'));
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <EditableTableStage
        projectId="project-1"
        instanceId="instance-1"
        assessmentId="lcoe_model"
        stageId="inputs"
        fields={baseFields}
        items={[
          {
            id: 'item-1',
            origin: 'inferred',
            content: {
              variable: 'Capacity factor',
              field_name: 'capacity_factor',
              value: 0.32,
              unit: '%',
              status: 'assumed',
              category: 'energy',
            },
          },
        ]}
        allowAddRows={false}
        onChanged={jest.fn()}
      />,
    );

    const label = screen.getByText('Capacity factor');
    fireEvent.mouseEnter(label);
    fireEvent.click(label);

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nitrogen:draft',
          detail: expect.objectContaining({
            toolHint: 'lcoe_model',
            fieldContext: expect.objectContaining({
              field_name: 'capacity_factor',
              assessment_id: 'lcoe_model',
            }),
          }),
        }),
      );
    });
  });
});

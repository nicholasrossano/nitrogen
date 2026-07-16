import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EditableTableStage } from '@/components/assessments/stages/EditableTableStage';
import { api } from '@/lib/api';
import type { BuildItem, FieldDef } from '@/lib/api/types';

const baseFields: FieldDef[] = [
  { name: 'variable', label: 'Variable', field_type: 'text', required: false, options: null, placeholder: null },
  { name: 'value', label: 'Value', field_type: 'number', required: false, options: null, placeholder: null },
  { name: 'unit', label: 'Unit', field_type: 'text', required: false, options: null, placeholder: null },
];

const baseItem: BuildItem = {
  id: 'item-1',
  origin: 'inferred',
  provenance: { derivation: 'assumed', sources: [], rationale: 'Test fixture' },
  confirmed: false,
  confirmed_at: null,
  removable: false,
  content: {
    variable: 'Capacity factor',
    field_name: 'capacity_factor',
    value: 0.32,
    unit: '%',
    status: 'assumed',
    category: 'energy',
  },
};

describe('EditableTableStage investigate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens variable-scoped chat when investigate resolves a variable', async () => {
    jest.spyOn(api, 'resolveVariable').mockResolvedValueOnce({
      found: true,
      variable: { id: 'variable-1' } as any,
    });
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <EditableTableStage
        projectId="project-1"
        instanceId="instance-1"
        assessmentId="lcoe_model"
        stageId="inputs"
        fields={baseFields}
        items={[baseItem]}
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
          type: 'nitrogen:open-variable-chat',
        }),
      );
    });
  });

  it('dispatches draft investigate payload with field context when variable creation fails', async () => {
    jest.spyOn(api, 'resolveVariable').mockResolvedValueOnce({
      found: false,
      variable: null,
    });
    jest.spyOn(api, 'createVariable').mockRejectedValueOnce(new Error('forbidden'));
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <EditableTableStage
        projectId="project-1"
        instanceId="instance-1"
        assessmentId="lcoe_model"
        stageId="inputs"
        fields={baseFields}
        items={[baseItem]}
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

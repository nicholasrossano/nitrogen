import { EDITOR_WIDGET_TYPES, WIDGET_MODEL_GROUP } from '@/components/editor/EditorSidePanel';

describe('EditorSidePanel widget registry', () => {
  it('keeps widget types unique', () => {
    expect(new Set(EDITOR_WIDGET_TYPES).size).toBe(EDITOR_WIDGET_TYPES.length);
  });

  it('keeps widget types and model groups in sync', () => {
    const widgetTypes = [...EDITOR_WIDGET_TYPES].sort();
    const modelGroupTypes = Object.keys(WIDGET_MODEL_GROUP).sort();
    expect(modelGroupTypes).toEqual(widgetTypes);
  });
});

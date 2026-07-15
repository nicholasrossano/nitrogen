import { FLOAT_WIDGET_TYPES, WIDGET_MODEL_GROUP } from '@/components/editor/FloatLayer';

describe('FloatLayer widget registry', () => {
  it('has unique widget type entries', () => {
    expect(new Set(FLOAT_WIDGET_TYPES).size).toBe(FLOAT_WIDGET_TYPES.length);
  });

  it('keeps FLOAT_WIDGET_TYPES and WIDGET_MODEL_GROUP in sync', () => {
    const widgetTypes = [...FLOAT_WIDGET_TYPES].sort();
    const modelGroupTypes = Object.keys(WIDGET_MODEL_GROUP).sort();
    expect(modelGroupTypes).toEqual(widgetTypes);
  });
});

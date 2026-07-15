export { ProjectHeader } from './ProjectHeader';
export { InputOutputBar } from './InputOutputBar';
export {
  FloatLayer,
  FLOAT_WIDGET_TYPES,
  WIDGET_MODEL_GROUP,
} from './FloatLayer';
export type { FloatWidget, AssessmentLogContext } from './FloatLayer';
/** @deprecated Prefer FloatLayer / FLOAT_WIDGET_TYPES / FloatWidget. */
export {
  FloatLayer as EditorSidePanel,
  FLOAT_WIDGET_TYPES as EDITOR_WIDGET_TYPES,
} from './FloatLayer';
export type { FloatWidget as EditorWidget } from './FloatLayer';
export type { WorkspacePanelTab } from './ProjectWorkspaceEditorPanel';

/**
 * Assessment widget registry for the workspace panel.
 *
 * Maps widget_type strings to their React components. All assessment widgets
 * that appear in the workspace are registered here. Chat interaction
 * widgets (proposed_value, template_proposed_value) are NOT registered here —
 * they live in ChatMessage.tsx.
 *
 * To add a new assessment widget:
 *   1. Create your widget component in /components/widgets/
 *   2. Add an entry to WIDGET_REGISTRY below
 */

import type { ComponentType } from 'react';
import type { PlanWorkspaceInspectorState } from '@/components/plan-workspace';
import { ENERGY_WIDGET_REGISTRY } from '@/domain/energy/widgetRegistry';

export interface WorkspaceWidgetFooterAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export interface WorkspaceWidgetFooterState {
  mode: 'confirm';
}

export interface WorkspaceWidgetProps {
  data: Record<string, any>;
  projectId: string;
  instanceId?: string;
  workflowVersion?: number;
  onWorkflowUpdated?: () => void;
  workspaceView?: 'build' | 'output';
  isActive?: boolean;
  outputFooterAction?: WorkspaceWidgetFooterAction;
  outputFooterState?: WorkspaceWidgetFooterState;
  /** Called when diagram item inspector state changes — drives the chat-panel deep-dive widget */
  onInspectorStateChange?: (state: PlanWorkspaceInspectorState | null) => void;
}

export type WidgetComponent = ComponentType<WorkspaceWidgetProps>;

// Lazy imports keep the initial bundle small. Platform widgets stay here;
// shipped assessment widgets are registered through first-party catalog config.
const WIDGET_REGISTRY: Record<string, () => Promise<{ default: WidgetComponent }>> = {
  document_viewer: () =>
    import('@/components/widgets/DocumentViewerWidget').then((m) => ({ default: m.DocumentViewerWidget as unknown as WidgetComponent })),
  ...ENERGY_WIDGET_REGISTRY,
};

/**
 * Return the known widget type IDs (for validation and tests).
 */
export function getRegisteredWidgetTypes(): string[] {
  return Object.keys(WIDGET_REGISTRY);
}

/**
 * Check whether a widget type is registered for workspace rendering.
 */
export function isRegisteredWidget(widgetType: string): boolean {
  return widgetType in WIDGET_REGISTRY;
}

export { WIDGET_REGISTRY };

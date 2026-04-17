/**
 * Module widget registry for the workspace panel.
 *
 * Maps widget_type strings to their React components. All module widgets
 * that appear in the workspace are registered here. Chat interaction
 * widgets (proposed_value, template_proposed_value) are NOT registered here —
 * they live in ChatMessage.tsx.
 *
 * To add a new module widget:
 *   1. Create your widget component in /components/widgets/
 *   2. Add an entry to WIDGET_REGISTRY below
 */

import type { ComponentType } from 'react';

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
  initiativeId: string;
  instanceId?: string;
  workflowVersion?: number;
  onWorkflowUpdated?: () => void;
  workspaceView?: 'build' | 'output';
  isActive?: boolean;
  outputFooterAction?: WorkspaceWidgetFooterAction;
  outputFooterState?: WorkspaceWidgetFooterState;
}

type WidgetComponent = ComponentType<WorkspaceWidgetProps>;

// Lazy imports keep the initial bundle small
const WIDGET_REGISTRY: Record<string, () => Promise<{ default: WidgetComponent }>> = {
  // Legacy widget keys (preserved for existing module_instances during migration)
  lcoe_inputs: () =>
    import('@/components/widgets/LCOEModelWidget').then((m) => ({ default: m.LCOEModelWidget as unknown as WidgetComponent })),
  lcoe_output: () =>
    import('@/components/widgets/LCOEModelWidget').then((m) => ({ default: m.LCOEModelWidget as unknown as WidgetComponent })),
  carbon_inputs: () =>
    import('@/components/widgets/CarbonModelWidget').then((m) => ({ default: m.CarbonModelWidget as unknown as WidgetComponent })),
  carbon_output: () =>
    import('@/components/widgets/CarbonModelWidget').then((m) => ({ default: m.CarbonModelWidget as unknown as WidgetComponent })),
  solar_inputs: () =>
    import('@/components/widgets/SolarEstimateWidget').then((m) => ({ default: m.SolarEstimateWidget as unknown as WidgetComponent })),
  solar_output: () =>
    import('@/components/widgets/SolarEstimateWidget').then((m) => ({ default: m.SolarEstimateWidget as unknown as WidgetComponent })),
  document_viewer: () =>
    import('@/components/widgets/DocumentViewerWidget').then((m) => ({ default: m.DocumentViewerWidget as unknown as WidgetComponent })),

  // Staged workflow result widget keys
  lcoe_results: () =>
    import('@/components/widgets/LCOEModelWidget').then((m) => ({ default: m.LCOEModelWidget as unknown as WidgetComponent })),
  carbon_results: () =>
    import('@/components/widgets/CarbonModelWidget').then((m) => ({ default: m.CarbonModelWidget as unknown as WidgetComponent })),
  solar_yield_results: () =>
    import('@/components/widgets/SolarEstimateWidget').then((m) => ({ default: m.SolarEstimateWidget as unknown as WidgetComponent })),

  // Assessment module map view (landscape mapping, stakeholder assessment)
  assessment_map: () =>
    import('@/components/widgets/AssessmentMapWidget').then((m) => ({ default: m.AssessmentMapWidget as unknown as WidgetComponent })),
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

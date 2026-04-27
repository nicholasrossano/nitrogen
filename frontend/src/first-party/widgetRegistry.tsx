import type { ComponentType } from 'react';
import type { WorkspaceWidgetProps } from '@/lib/widgetRegistry';

type WidgetComponent = ComponentType<WorkspaceWidgetProps>;

export const FIRST_PARTY_WIDGET_REGISTRY: Record<string, () => Promise<{ default: WidgetComponent }>> = {
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

  // Implementation plan map view
  implementation_plan: () =>
    import('@/components/widgets/ImplementationPlanWidget').then((m) => ({ default: m.ImplementationPlanWidget as unknown as WidgetComponent })),
};


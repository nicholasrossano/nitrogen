export type InitiativeStage = 'intake' | 'evidence' | 'generate' | 'complete';

/**
 * Chat-surface interaction widget types.
 * Assessment widgets (lcoe_inputs, carbon_inputs, etc.) are NOT included here —
 * they render exclusively in the editor workspace via widgetRegistry.tsx.
 */
export type ChatWidgetType =
  | 'confirmation'
  | 'evidence_input'
  | 'memo_viewer'
  | 'proposed_value'
  | 'template_proposed_value'
  | 'assessment_workspace';

/** @deprecated Use ChatWidgetType for chat surface widgets */
export type WidgetType = ChatWidgetType;

export type MessageRole = 'user' | 'assistant' | 'system';

export type Recommendation = 'proceed' | 'hold' | 'reject';

export interface InitiativeSummary {
  title: string | null;
  sector: string | null;
  geography: string | null;
  target_population: string | null;
  goal: string | null;
  budget_range: string | null;
  timeline: string | null;
  constraints: string[];
}

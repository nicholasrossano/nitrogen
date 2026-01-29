export type InitiativeStage = 'intake' | 'evidence' | 'generate' | 'complete';

export type WidgetType = 
  | 'confirmation' 
  | 'evidence_input' 
  | 'generate_options' 
  | 'memo_viewer';

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

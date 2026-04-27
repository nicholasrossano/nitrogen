export interface ModelInputContextSource {
  label: string;
  widgetTypes: string[];
}

export const MODEL_INPUT_CONTEXT_SOURCES: ModelInputContextSource[] = [
  {
    label: 'LCOE Model',
    widgetTypes: ['lcoe_inputs', 'lcoe_output'],
  },
  {
    label: 'Carbon Model',
    widgetTypes: ['carbon_inputs', 'carbon_output'],
  },
  {
    label: 'Solar Production Estimate',
    widgetTypes: ['solar_inputs', 'solar_output'],
  },
];

export const PROPOSAL_MODEL_TYPES_BY_MODULE_ID: Record<string, 'lcoe' | 'carbon' | 'solar'> = {
  lcoe_model: 'lcoe',
  carbon_model: 'carbon',
  solar_estimate: 'solar',
};

export const SOLAR_LOCATION_MODULE_ID = 'solar_estimate';

export const TECHNOLOGY_TYPE_OPTIONS = ['solar_pv', 'wind', 'battery', 'mini_grid', 'clean_cooking', 'default'];

export const TABLE_CATEGORY_ORDER = ['project', 'energy', 'costs', 'finance', 'timing', 'general'];

export const TABLE_CATEGORY_LABELS: Record<string, string> = {
  project: 'Project Definition',
  energy: 'Energy Production',
  costs: 'Costs',
  finance: 'Finance & Discounting',
  timing: 'Timing',
  general: 'General',
};


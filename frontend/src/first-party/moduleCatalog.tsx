import { BarChart2, Calculator, Leaf, Map, Network, ShieldCheck, Sun, Users } from 'lucide-react';

export interface ModuleOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** If true, only shown when Developer > Beta features is enabled in Settings. */
  beta?: boolean;
}

export const ALL_MODULES: ModuleOption[] = [
  {
    id: 'lcoe_model',
    name: 'LCOE Model',
    description: 'Calculate levelized cost of energy',
    icon: <Calculator className="w-3.5 h-3.5" />,
  },
  {
    id: 'carbon_model',
    name: 'Carbon Calculator',
    description: 'Estimate emission reductions (tCO₂e)',
    icon: <Leaf className="w-3.5 h-3.5" />,
  },
  {
    id: 'solar_estimate',
    name: 'Solar Production Estimate',
    description: 'Estimate annual & monthly kWh',
    icon: <Sun className="w-3.5 h-3.5" />,
  },
  {
    id: 'stakeholder_assessment',
    name: 'Stakeholder Assessment',
    description: 'Map and profile key stakeholders for your project',
    icon: <Users className="w-3.5 h-3.5" />,
  },
  {
    id: 'landscape_mapping',
    name: 'Landscape Mapping',
    description: 'Map the ecosystem of actors and initiatives',
    icon: <Map className="w-3.5 h-3.5" />,
  },
  {
    id: 'implementation_plan',
    name: 'Implementation Plan',
    description: 'Convert your project framework into a phased execution plan',
    icon: <Network className="w-3.5 h-3.5" />,
  },
  {
    id: 'esmp',
    name: 'Environmental & Social Management Plan',
    description: 'Draft an IFC-aligned ESMP for DFI submission',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    beta: true,
  },
  {
    id: 'mel_plan',
    name: 'Monitoring, Evaluation & Learning Plan',
    description: 'Build a results framework and data collection plan',
    icon: <BarChart2 className="w-3.5 h-3.5" />,
    beta: true,
  },
];

export const ANALYSIS_MODULES = ALL_MODULES.filter(
  (m) => m.id === 'lcoe_model' || m.id === 'carbon_model' || m.id === 'solar_estimate'
);

/** Modules available in the New Module landing page (standalone, not project-side-chat only) */
export const STANDALONE_MODULE_IDS = new Set(['lcoe_model', 'carbon_model', 'solar_estimate']);

export interface ModuleCategory {
  id: string;
  name: string;
  moduleIds: string[];
}

export const MODULE_CATEGORIES: ModuleCategory[] = [
  { id: 'opportunity', name: 'Opportunity Discovery', moduleIds: ['landscape_mapping'] },
  { id: 'definition', name: 'Project Definition', moduleIds: ['stakeholder_assessment', 'implementation_plan'] },
  { id: 'feasibility', name: 'Feasibility & Option Analysis', moduleIds: ['lcoe_model', 'solar_estimate'] },
  { id: 'impact', name: 'Impact Assessment', moduleIds: ['carbon_model'] },
  { id: 'compliance', name: 'Compliance & Delivery Readiness', moduleIds: ['esmp', 'mel_plan'] },
];


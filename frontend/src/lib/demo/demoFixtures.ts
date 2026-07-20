/**
 * Static fixtures for client-side demo mode.
 * Realistic Sub-Saharan solar + storage project — read-only via shared_role: viewer.
 */

import type {
  AssessmentInstance,
  AssessmentAgentStatus,
  AssessmentActivityLog,
  BillingStatus,
  ChatMessage,
  EvidenceDoc,
  Project,
  ProjectFilesResponse,
  ProjectMaterial,
  ProjectShare,
  ProjectStatusResponse,
  ProjectPlan,
  SourceCitation,
  StagedAssessmentWorkflowState,
  Variable,
  VariableComment,
  VariableSummary,
  Workspace,
  WorkspaceDetail,
  WorkspaceMember,
} from '@/lib/api/types';
import { DEMO_PROJECT_ID, DEMO_WORKSPACE_ID } from '@/lib/demo/demoSession';

const NOW = '2026-06-18T14:22:00.000Z';
const WEEK_AGO = '2026-06-11T09:10:00.000Z';
const TWO_WEEKS_AGO = '2026-06-04T11:30:00.000Z';
const MONTH_AGO = '2026-05-20T08:00:00.000Z';

export const DEMO_OWNER_EMAIL = 'amara.okello@riftvalley.energy';
export const DEMO_OWNER_NAME = 'Amara Okello';

const DEMO_USER_ID = 'demo-user-owner';
const DEMO_COLLAB_1 = 'demo-user-james';
const DEMO_COLLAB_2 = 'demo-user-priya';
const DEMO_COLLAB_3 = 'demo-user-luis';

export const DEMO_CHAT_LCOE_ID = 'demo-chat-lcoe-sensitivity';
export const DEMO_CHAT_CARBON_ID = 'demo-chat-carbon-grid';
export const DEMO_CHAT_STAKEHOLDER_ID = 'demo-chat-stakeholder';

export const DEMO_INSTANCE_LCOE = 'demo-inst-lcoe';
export const DEMO_INSTANCE_CARBON = 'demo-inst-carbon';
export const DEMO_INSTANCE_SOLAR = 'demo-inst-solar-prod';
export const DEMO_INSTANCE_STAKEHOLDER = 'demo-inst-stakeholder';
export const DEMO_INSTANCE_IMPL = 'demo-inst-implementation';

export const DEMO_VAR_CAPACITY_FACTOR = 'demo-var-capacity-factor';
export const DEMO_VAR_CAPEX = 'demo-var-capex-kw';
export const DEMO_VAR_OM = 'demo-var-om';
export const DEMO_VAR_DISCOUNT = 'demo-var-discount';
export const DEMO_VAR_GRID_EF = 'demo-var-grid-ef';
export const DEMO_VAR_PPA = 'demo-var-ppa-tariff';
export const DEMO_VAR_BESS = 'demo-var-bess-hours';
export const DEMO_VAR_BESS_ENERGY = 'demo-var-bess-mwh';

export const demoWorkspace: Workspace = {
  id: DEMO_WORKSPACE_ID,
  name: 'Rift Valley Energy',
  icon: '☀️',
  description: 'Demo workspace for the Rift Valley Solar portfolio.',
  workspace_type: 'team',
  current_user_role: 'member',
  created_at: MONTH_AGO,
  updated_at: NOW,
};

export const demoWorkspaceMembers: WorkspaceMember[] = [
  {
    id: 'demo-wm-owner',
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_USER_ID,
    user_email: DEMO_OWNER_EMAIL,
    user_display_name: DEMO_OWNER_NAME,
    role: 'owner',
    created_at: MONTH_AGO,
  },
  {
    id: 'demo-wm-james',
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_COLLAB_1,
    user_email: 'james.mwangi@riftvalley.energy',
    user_display_name: 'James Mwangi',
    role: 'member',
    created_at: TWO_WEEKS_AGO,
  },
  {
    id: 'demo-wm-priya',
    workspace_id: DEMO_WORKSPACE_ID,
    user_id: DEMO_COLLAB_2,
    user_email: 'priya.shah@climatepartners.org',
    user_display_name: 'Priya Shah',
    role: 'member',
    created_at: TWO_WEEKS_AGO,
  },
];

export const demoWorkspaceDetail: WorkspaceDetail = {
  ...demoWorkspace,
  members: demoWorkspaceMembers,
};

const projectPlan: ProjectPlan = {
  generated_at: WEEK_AGO,
  plan_type: 'energy',
  schema_version: 1,
  phases: [
    { id: 'phase-screen', name: 'Screen', description: 'Technical and climate screening' },
    { id: 'phase-diligence', name: 'Diligence', description: 'Stakeholders and delivery' },
  ],
  pillars: [
    {
      id: 'pillar-tech',
      name: 'Technical',
      summary: 'Generation cost and resource confidence',
      items: [
        {
          id: 'plan-lcoe',
          title: 'LCOE Model',
          item_type: 'assessment',
          classification: 'required',
          status: 'complete',
          rationale: 'Core bankability metric for the PV + BESS plant.',
          phase: 'phase-screen',
          phase_order: 1,
        },
        {
          id: 'plan-solar',
          title: 'Solar Production Estimate',
          item_type: 'assessment',
          classification: 'required',
          status: 'complete',
          rationale: 'P50/P90 generation underpins offtake and carbon claims.',
          phase: 'phase-screen',
          phase_order: 2,
        },
      ],
    },
    {
      id: 'pillar-climate',
      name: 'Climate',
      summary: 'Grid displacement and reporting',
      items: [
        {
          id: 'plan-carbon',
          title: 'Carbon Calculator',
          item_type: 'assessment',
          classification: 'required',
          status: 'complete',
          rationale: 'Annual and lifetime abatement for DFI reporting.',
          phase: 'phase-screen',
          phase_order: 3,
        },
      ],
    },
    {
      id: 'pillar-stakeholder',
      name: 'Stakeholders',
      summary: 'Community and institutional engagement',
      items: [
        {
          id: 'plan-stakeholder',
          title: 'Stakeholder Assessment',
          item_type: 'assessment',
          classification: 'required',
          status: 'in_progress',
          rationale: 'ESIA follow-through before construction readiness.',
          phase: 'phase-diligence',
          phase_order: 1,
        },
      ],
    },
    {
      id: 'pillar-delivery',
      name: 'Delivery',
      summary: 'Execution sequencing',
      items: [
        {
          id: 'plan-impl',
          title: 'Implementation Plan',
          item_type: 'assessment',
          classification: 'optional',
          status: 'not_started',
          rationale: 'Construction and interconnection schedule.',
          phase: 'phase-diligence',
          phase_order: 2,
        },
      ],
    },
  ],
};

export const demoProject: Project = {
  id: DEMO_PROJECT_ID,
  slug: 'rift-valley-solar',
  user_id: DEMO_USER_ID,
  workspace_id: DEMO_WORKSPACE_ID,
  title: 'Rift Valley Solar — 40 MW PV + BESS',
  name: 'Rift Valley Solar — 40 MW PV + BESS',
  subject: 'Utility-scale solar PV with 4-hour battery storage in Nakuru County, Kenya',
  icon: '☀️',
  sector: 'energy',
  geography: 'Kenya — Nakuru County',
  target_population: 'National grid offtake via KPLC; local employment during construction',
  goal: 'Deliver competitive renewable power with firming storage under a 20-year PPA',
  budget_range: '$48–55M all-in',
  timeline: 'COD target Q4 2028',
  constraints: [
    'Grid interconnection at 132 kV substation',
    'IFC Performance Standards alignment',
    'Local content requirements for EPC',
  ],
  stage: 'execute',
  stage_1_complete: true,
  evidence_ready: true,
  archived: false,
  created_by: DEMO_USER_ID,
  created_at: MONTH_AGO,
  updated_at: NOW,
  project_description:
    'A 40 MWAC solar photovoltaic plant paired with a 40 MW / 160 MWh battery energy storage system (BESS) in Nakuru County, Kenya. The project targets a 20-year power purchase agreement with Kenya Power and Lighting Company (KPLC), with financing structured around DFI senior debt and sponsor equity.',
  project_type: 'utility_solar_storage',
  overview_description:
    'Rift Valley Solar combines 40 MW of solar PV with a 4-hour BESS to supply firm renewable energy to the Kenyan grid. Feasibility, offtake term sheet, and ESIA packages are in place. LCOE and carbon assessments are complete; stakeholder and implementation workstreams are advancing toward financial close.',
  overview_generated_at: WEEK_AGO,
  selected_tools: [
    'lcoe_model',
    'carbon_model',
    'solar_estimate',
    'stakeholder_assessment',
    'implementation_plan',
  ],
  tool_inputs: null,
  deliverables: null,
  project_plan: projectPlan,
  assessment_instances: null,
  assessment_instances_count: 5,
  generated_assessments_count: 3,
  shared_role: 'viewer',
  owner_email: DEMO_OWNER_EMAIL,
};

export const demoShares: ProjectShare[] = [
  {
    id: 'demo-share-james',
    project_id: DEMO_PROJECT_ID,
    user_id: DEMO_COLLAB_1,
    user_email: 'james.mwangi@riftvalley.energy',
    user_display_name: 'James Mwangi',
    role: 'editor',
    created_at: TWO_WEEKS_AGO,
  },
  {
    id: 'demo-share-priya',
    project_id: DEMO_PROJECT_ID,
    user_id: DEMO_COLLAB_2,
    user_email: 'priya.shah@climatepartners.org',
    user_display_name: 'Priya Shah',
    role: 'editor',
    created_at: TWO_WEEKS_AGO,
  },
  {
    id: 'demo-share-luis',
    project_id: DEMO_PROJECT_ID,
    user_id: DEMO_COLLAB_3,
    user_email: 'luis.fernandez@dfi.example',
    user_display_name: 'Luis Fernández',
    role: 'viewer',
    created_at: WEEK_AGO,
  },
];

function makeInstance(
  id: string,
  assessmentId: string,
  title: string,
  status: AssessmentInstance['status'],
  startedAt: string,
  isPlanComplete: boolean,
): AssessmentInstance {
  return {
    id,
    assessment_id: assessmentId,
    status,
    title,
    instance_number: 1,
    creator_handle: 'amara',
    display_name: title,
    started_by: DEMO_USER_ID,
    started_by_email: DEMO_OWNER_EMAIL,
    started_at: startedAt,
    updated_at: NOW,
    chat_id: null,
    deliverable: null,
    workflow_state: null,
    is_plan_complete: isPlanComplete,
  };
}

export const demoAssessmentInstances: AssessmentInstance[] = [
  makeInstance(DEMO_INSTANCE_LCOE, 'lcoe_model', 'LCOE Model', 'complete', TWO_WEEKS_AGO, true),
  makeInstance(DEMO_INSTANCE_CARBON, 'carbon_model', 'Carbon Calculator', 'complete', TWO_WEEKS_AGO, true),
  makeInstance(DEMO_INSTANCE_SOLAR, 'solar_estimate', 'Solar Production Estimate', 'complete', WEEK_AGO, true),
  makeInstance(DEMO_INSTANCE_STAKEHOLDER, 'stakeholder_assessment', 'Stakeholder Assessment', 'complete', WEEK_AGO, true),
  makeInstance(DEMO_INSTANCE_IMPL, 'implementation_plan', 'Implementation Plan', 'draft', NOW, false),
];

export const demoMaterials: ProjectMaterial[] = [
  {
    id: 'demo-mat-feasibility',
    filename: 'Rift_Valley_Solar_Feasibility_Study_v3.pdf',
    file_type: 'application/pdf',
    file_size: 4_820_000,
    created_at: MONTH_AGO,
    source: 'evidence',
    processing_status: 'indexed',
  },
  {
    id: 'demo-mat-ppa',
    filename: 'KPLC_PPA_Term_Sheet_Draft.pdf',
    file_type: 'application/pdf',
    file_size: 890_000,
    created_at: TWO_WEEKS_AGO,
    source: 'evidence',
    processing_status: 'indexed',
  },
  {
    id: 'demo-mat-esia',
    filename: 'ESIA_Nakuru_Solar_Storage_2026.pdf',
    file_type: 'application/pdf',
    file_size: 6_100_000,
    created_at: TWO_WEEKS_AGO,
    source: 'evidence',
    processing_status: 'indexed',
  },
  {
    id: 'demo-mat-sld',
    filename: 'Single_Line_Diagram_40MW_BESS.pdf',
    file_type: 'application/pdf',
    file_size: 1_240_000,
    created_at: WEEK_AGO,
    source: 'evidence',
    processing_status: 'indexed',
  },
  {
    id: 'demo-mat-geo',
    filename: 'Geotechnical_Report_Site_A.pdf',
    file_type: 'application/pdf',
    file_size: 3_400_000,
    created_at: WEEK_AGO,
    source: 'evidence',
    processing_status: 'indexed',
  },
];

export const demoEvidence: EvidenceDoc[] = demoMaterials.map((m) => ({
  id: m.id,
  filename: m.filename,
  file_type: m.file_type,
  file_size: m.file_size,
  created_at: m.created_at,
  chunk_count: 48,
  processing_status: 'indexed',
}));

export const demoFilesResponse: ProjectFilesResponse = {
  uploaded: demoMaterials,
  generated: [
    {
      id: 'demo-gen-lcoe',
      title: 'LCOE Model Results',
      output_type: 'lcoe',
      created_at: TWO_WEEKS_AGO,
      exportable: true,
      export_format: 'xlsx',
      exported: false,
      download_url: null,
    },
    {
      id: 'demo-gen-carbon',
      title: 'Carbon Displacement Summary',
      output_type: 'carbon',
      created_at: TWO_WEEKS_AGO,
      exportable: true,
      export_format: 'xlsx',
      exported: false,
      download_url: null,
    },
  ],
};

function makeVariable(
  id: string,
  key: string,
  label: string,
  value: number,
  unit: string,
  valueType: Variable['value_type'],
  status: Variable['status'],
  assessments: string[],
  notes: string | null,
  email: string,
): Variable {
  return {
    id,
    project_id: DEMO_PROJECT_ID,
    key,
    label,
    value,
    unit,
    value_type: valueType,
    source_type: status === 'validated' ? 'user_input' : status === 'extracted' ? 'extraction' : 'user_input',
    source_reference: status === 'extracted'
      ? { evidence_doc_id: 'demo-mat-feasibility', filename: 'Rift_Valley_Solar_Feasibility_Study_v3.pdf' }
      : null,
    aliases: null,
    status,
    used_in_assessments: assessments,
    notes,
    created_by_email: email,
    last_updated_by_email: email,
    created_at: TWO_WEEKS_AGO,
    updated_at: WEEK_AGO,
  };
}

export const demoVariables: Variable[] = [
  makeVariable(
    DEMO_VAR_CAPACITY_FACTOR,
    'capacity_factor',
    'Capacity factor',
    // Percentage points (22%), matching extraction convention — not a 0–1 fraction.
    22,
    '%',
    'percent',
    'validated',
    ['lcoe_model', 'solar_estimate'],
    'P50 from feasibility resource assessment (Nakuru meteo year).',
    DEMO_OWNER_EMAIL,
  ),
  makeVariable(
    DEMO_VAR_CAPEX,
    'capex_per_kw',
    'All-in CAPEX per kW',
    1100,
    'USD/kW',
    'currency',
    'validated',
    ['lcoe_model'],
    'Blended PV + 4h BESS package ($980/kW PV + ~$120/kW BESS-equivalent); excludes IDC.',
    'james.mwangi@riftvalley.energy',
  ),
  makeVariable(
    DEMO_VAR_OM,
    'annual_om',
    'Annual O&M (PV)',
    18,
    'USD/kW-yr',
    'currency',
    'extracted',
    ['lcoe_model'],
    'PV O&M from EPC schedule; BESS O&M / augmentation modeled separately.',
    DEMO_OWNER_EMAIL,
  ),
  makeVariable(
    DEMO_VAR_DISCOUNT,
    'discount_rate',
    'Discount rate (WACC)',
    // Percentage points (8%), matching extraction convention — not a 0–1 fraction.
    8,
    '%',
    'percent',
    'assumed',
    ['lcoe_model'],
    'Blended DFI debt + sponsor equity; sensitivity at 7–10%.',
    'priya.shah@climatepartners.org',
  ),
  makeVariable(
    DEMO_VAR_GRID_EF,
    'grid_emission_factor',
    'Grid emission factor',
    0.48,
    'tCO2e/MWh',
    'number',
    'validated',
    ['carbon_model'],
    'Kenya combined-margin grid EF (operating + build), ~2024 vintage for renewable displacement.',
    DEMO_OWNER_EMAIL,
  ),
  makeVariable(
    DEMO_VAR_PPA,
    'ppa_tariff',
    'PPA tariff',
    0.072,
    'USD/kWh',
    'currency',
    'extracted',
    ['lcoe_model'],
    'Indicative level from KPLC term sheet draft (non-binding; escalation not yet in LCOE).',
    'james.mwangi@riftvalley.energy',
  ),
  makeVariable(
    DEMO_VAR_BESS,
    'bess_duration_hours',
    'BESS duration',
    4,
    'hours',
    'number',
    'validated',
    ['lcoe_model', 'solar_estimate'],
    'Discharge duration at rated power for the 40 MW / 160 MWh block.',
    DEMO_OWNER_EMAIL,
  ),
  makeVariable(
    DEMO_VAR_BESS_ENERGY,
    'bess_energy_mwh',
    'BESS energy capacity',
    160,
    'MWh',
    'number',
    'validated',
    ['lcoe_model', 'solar_estimate'],
    'Nameplate storage energy; pairs with 40 MW / 4h duration.',
    DEMO_OWNER_EMAIL,
  ),
];

export const demoVariableSummary: VariableSummary = {
  total: demoVariables.length,
  validated: demoVariables.filter((v) => v.status === 'validated').length,
  extracted: demoVariables.filter((v) => v.status === 'extracted').length,
  assumed: demoVariables.filter((v) => v.status === 'assumed').length,
  missing: 0,
  top_attention: demoVariables
    .filter((v) => v.status === 'assumed' || v.status === 'extracted')
    .slice(0, 3)
    .map((v) => ({
      id: v.id,
      key: v.key,
      label: v.label,
      status: v.status,
      used_in_assessments: v.used_in_assessments,
    })),
};

export const demoVariableComments: Record<string, VariableComment[]> = {
  [DEMO_VAR_CAPACITY_FACTOR]: [
    {
      id: 'demo-vc-cf-1',
      variable_id: DEMO_VAR_CAPACITY_FACTOR,
      project_id: DEMO_PROJECT_ID,
      body: 'Confirmed against the 12-month on-site pyranometer campaign in the feasibility study §4.2.',
      created_by_email: DEMO_OWNER_EMAIL,
      created_at: TWO_WEEKS_AGO,
    },
    {
      id: 'demo-vc-cf-2',
      variable_id: DEMO_VAR_CAPACITY_FACTOR,
      project_id: DEMO_PROJECT_ID,
      body: 'Luis asked for a P90 case at 20% — worth a sensitivity run before IC.',
      created_by_email: 'priya.shah@climatepartners.org',
      created_at: WEEK_AGO,
    },
  ],
  [DEMO_VAR_CAPEX]: [
    {
      id: 'demo-vc-capex-1',
      variable_id: DEMO_VAR_CAPEX,
      project_id: DEMO_PROJECT_ID,
      body: 'EPC indicative at $980/kW PV + ~$120/kW-equivalent for the 4h BESS. Holding $1,100/kW all-in blended until binding bids — not PV-only.',
      created_by_email: 'james.mwangi@riftvalley.energy',
      created_at: WEEK_AGO,
    },
  ],
  [DEMO_VAR_OM]: [
    {
      id: 'demo-vc-om-1',
      variable_id: DEMO_VAR_OM,
      project_id: DEMO_PROJECT_ID,
      body: 'This line is PV O&M only. Battery augmentation / replacement sits in a separate opex schedule for IC.',
      created_by_email: DEMO_OWNER_EMAIL,
      created_at: WEEK_AGO,
    },
  ],
  [DEMO_VAR_DISCOUNT]: [
    {
      id: 'demo-vc-disc-1',
      variable_id: DEMO_VAR_DISCOUNT,
      project_id: DEMO_PROJECT_ID,
      body: 'DFI term sheet sketch implies ~6.5% debt; equity hurdle 12–14%. 8% WACC is the base case for LCOE.',
      created_by_email: 'priya.shah@climatepartners.org',
      created_at: WEEK_AGO,
    },
    {
      id: 'demo-vc-disc-2',
      variable_id: DEMO_VAR_DISCOUNT,
      project_id: DEMO_PROJECT_ID,
      body: 'Flagging FX: tariff is USD-linked but opex partly KES — keep an eye on real WACC.',
      created_by_email: 'luis.fernandez@dfi.example',
      created_at: '2026-06-12T16:40:00.000Z',
    },
  ],
  [DEMO_VAR_PPA]: [
    {
      id: 'demo-vc-ppa-1',
      variable_id: DEMO_VAR_PPA,
      project_id: DEMO_PROJECT_ID,
      body: 'Term sheet is non-binding at $0.072/kWh. Escalation at CPI-US with a 2% floor — not yet modeled in LCOE.',
      created_by_email: 'james.mwangi@riftvalley.energy',
      created_at: '2026-06-13T10:15:00.000Z',
    },
  ],
  [DEMO_VAR_GRID_EF]: [
    {
      id: 'demo-vc-ef-1',
      variable_id: DEMO_VAR_GRID_EF,
      project_id: DEMO_PROJECT_ID,
      body: 'Using Kenya combined-margin EF (~0.48 tCO₂e/MWh, ~2024). Confirm OM vs BM weights before registering a carbon methodology.',
      created_by_email: DEMO_OWNER_EMAIL,
      created_at: WEEK_AGO,
    },
  ],
};

const lcoeSources: SourceCitation[] = [
  {
    source_type: 'evidence',
    source_title: 'Rift Valley Solar Feasibility Study v3',
    confidence: 0.92,
    evidence_doc_id: 'demo-mat-feasibility',
    chunk_index: 12,
  },
  {
    source_type: 'evidence',
    source_title: 'KPLC PPA Term Sheet Draft',
    confidence: 0.85,
    evidence_doc_id: 'demo-mat-ppa',
    chunk_index: 3,
  },
];

export type DemoChatMeta = {
  id: string;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  compare_project_ids: string[] | null;
  project_id: string | null;
  variable_id: string | null;
};

export const demoChatMetas: DemoChatMeta[] = [
  {
    id: DEMO_CHAT_LCOE_ID,
    title: 'LCOE sensitivity to CAPEX',
    created_at: TWO_WEEKS_AGO,
    updated_at: WEEK_AGO,
    message_count: 4,
    compare_project_ids: null,
    project_id: DEMO_PROJECT_ID,
    variable_id: null,
  },
  {
    id: DEMO_CHAT_CARBON_ID,
    title: 'Grid EF and annual abatement',
    created_at: WEEK_AGO,
    updated_at: WEEK_AGO,
    message_count: 4,
    compare_project_ids: null,
    project_id: DEMO_PROJECT_ID,
    variable_id: null,
  },
  {
    id: DEMO_CHAT_STAKEHOLDER_ID,
    title: 'Community engagement sequencing',
    created_at: '2026-06-14T08:20:00.000Z',
    updated_at: '2026-06-15T11:05:00.000Z',
    message_count: 4,
    compare_project_ids: null,
    project_id: DEMO_PROJECT_ID,
    variable_id: null,
  },
];

export const demoChatMessages: Record<string, ChatMessage[]> = {
  [DEMO_CHAT_LCOE_ID]: [
    {
      id: 'demo-msg-lcoe-u1',
      role: 'user',
      content: 'How sensitive is LCOE if CAPEX lands at $1,200/kW instead of $1,100?',
      widget_type: null,
      widget_data: null,
      created_at: TWO_WEEKS_AGO,
    },
    {
      id: 'demo-msg-lcoe-a1',
      role: 'assistant',
      content:
        'At the current 22% capacity factor, 8% WACC, and $18/kW-yr O&M, raising all-in CAPEX from **$1,100/kW to $1,200/kW** lifts LCOE from about **$0.054/kWh to ~$0.058/kWh**, roughly a **7-8%** increase.\n\nThat still clears the indicative **$0.072/kWh** PPA tariff with headroom, but the equity IRR compresses. I can propose updating the CAPEX variable if you want to run the model at $1,200.',
      widget_type: 'proposed_value',
      widget_data: {
        field_name: 'capex_per_kw',
        label: 'CAPEX per kW',
        current_value: 1100,
        proposed_value: 1200,
        unit: 'USD/kW',
        model_type: 'lcoe',
        assessment_id: 'lcoe_model',
        variable_id: DEMO_VAR_CAPEX,
        rationale: 'Stress case aligned with upper-bound EPC + BESS package quotes.',
        status: 'pending',
      },
      sources: lcoeSources,
      thinking_lines: ['Pulled LCOE base case inputs', 'Scaled CAPEX while holding CF, WACC, O&M'],
      completion_meta: { latency_ms: 2400, citation_count: 2, tiers_used: ['evidence'] },
      created_at: '2026-06-04T11:32:00.000Z',
    },
    {
      id: 'demo-msg-lcoe-u2',
      role: 'user',
      content: 'Keep base case at 1100 for now; note the stress case for IC.',
      widget_type: null,
      widget_data: null,
      created_at: '2026-06-04T11:40:00.000Z',
    },
    {
      id: 'demo-msg-lcoe-a2',
      role: 'assistant',
      content:
        'Understood. Base CAPEX stays at **$1,100/kW**. For investment committee, call out a **+$100/kW** CAPEX stress (~**$0.058/kWh** LCOE) alongside the P90 capacity-factor case Priya flagged on the capacity-factor variable.',
      widget_type: null,
      widget_data: null,
      sources: lcoeSources,
      completion_meta: { latency_ms: 1800, citation_count: 1, tiers_used: ['evidence'] },
      created_at: '2026-06-04T11:41:00.000Z',
    },
  ],
  [DEMO_CHAT_CARBON_ID]: [
    {
      id: 'demo-msg-carbon-u1',
      role: 'user',
      content: 'What annual CO2e displacement should we quote using the Kenya grid emission factor?',
      widget_type: null,
      widget_data: null,
      created_at: WEEK_AGO,
    },
    {
      id: 'demo-msg-carbon-a1',
      role: 'assistant',
      content:
        'With **~77 GWh/year** net generation (40 MWAC × 22% CF × 8760) and a grid emission factor of **0.48 tCO2e/MWh**, annual displacement is about **37,000 tCO2e/yr** before degradation.\n\nOver 25 years with 0.5%/yr module degradation, lifetime abatement is on the order of **~850,000 tCO2e**. Cite the feasibility generation table and the Kenya combined-margin EF in the carbon memo.',
      widget_type: null,
      widget_data: null,
      sources: [
        {
          source_type: 'evidence',
          source_title: 'Rift Valley Solar Feasibility Study v3',
          confidence: 0.9,
          evidence_doc_id: 'demo-mat-feasibility',
          chunk_index: 28,
        },
        {
          source_type: 'corpus',
          source_title: 'Kenya grid emission factor guidance',
          confidence: 0.78,
          publisher: 'Nitrogen AI corpus',
        },
      ],
      completion_meta: { latency_ms: 2100, citation_count: 2, tiers_used: ['evidence', 'corpus'] },
      created_at: '2026-06-11T09:15:00.000Z',
    },
    {
      id: 'demo-msg-carbon-u2',
      role: 'user',
      content: 'Does BESS charging from solar change the claim?',
      widget_type: null,
      widget_data: null,
      created_at: '2026-06-11T09:22:00.000Z',
    },
    {
      id: 'demo-msg-carbon-a2',
      role: 'assistant',
      content:
        'If BESS is charged exclusively from on-site PV (as designed), round-trip losses reduce delivered MWh slightly but do **not** introduce fossil charging. Use **net AC export** for the displacement claim; call out ~8–10% storage losses separately so reviewers do not double-count.',
      widget_type: null,
      widget_data: null,
      sources: [
        {
          source_type: 'evidence',
          source_title: 'Single Line Diagram 40MW BESS',
          confidence: 0.88,
          evidence_doc_id: 'demo-mat-sld',
          chunk_index: 1,
        },
      ],
      completion_meta: { latency_ms: 1600, citation_count: 1, tiers_used: ['evidence'] },
      created_at: '2026-06-11T09:24:00.000Z',
    },
  ],
  [DEMO_CHAT_STAKEHOLDER_ID]: [
    {
      id: 'demo-msg-stk-u1',
      role: 'user',
      content: 'Who should we engage first around the Nakuru site based on the ESIA?',
      widget_type: null,
      widget_data: null,
      created_at: '2026-06-14T08:20:00.000Z',
    },
    {
      id: 'demo-msg-stk-a1',
      role: 'assistant',
      content:
        'The ESIA prioritizes: (1) **county administration and NEMA**, (2) **adjacent community committees** along the access road, and (3) **KPLC interconnection stakeholders**. Livelihood impacts are concentrated near the northern boundary grazing corridor — schedule those meetings before fencing mobilization.\n\nI can draft a sequenced engagement calendar for the Implementation Plan when you are ready.',
      widget_type: null,
      widget_data: null,
      sources: [
        {
          source_type: 'evidence',
          source_title: 'ESIA Nakuru Solar Storage 2026',
          confidence: 0.93,
          evidence_doc_id: 'demo-mat-esia',
          chunk_index: 40,
        },
      ],
      completion_meta: { latency_ms: 2200, citation_count: 1, tiers_used: ['evidence'] },
      created_at: '2026-06-14T08:23:00.000Z',
    },
    {
      id: 'demo-msg-stk-u2',
      role: 'user',
      content: 'Any red flags in the geotech for community messaging?',
      widget_type: null,
      widget_data: null,
      created_at: '2026-06-15T11:00:00.000Z',
    },
    {
      id: 'demo-msg-stk-a2',
      role: 'assistant',
      content:
        'Geotech notes localized expansive clays — foundation design absorbs this; it is **not** a resettlement driver. For community messaging, emphasize that earthworks stay within the leased footprint and that borrow pits (if any) will follow the ESIA reinstatement plan. No new land acquisition is implied by the foundation redesign.',
      widget_type: null,
      widget_data: null,
      sources: [
        {
          source_type: 'evidence',
          source_title: 'Geotechnical Report Site A',
          confidence: 0.87,
          evidence_doc_id: 'demo-mat-geo',
          chunk_index: 8,
        },
        {
          source_type: 'evidence',
          source_title: 'ESIA Nakuru Solar Storage 2026',
          confidence: 0.8,
          evidence_doc_id: 'demo-mat-esia',
          chunk_index: 55,
        },
      ],
      completion_meta: { latency_ms: 1900, citation_count: 2, tiers_used: ['evidence'] },
      created_at: '2026-06-15T11:05:00.000Z',
    },
  ],
};

function statusCategory(input: {
  key: string;
  label: string;
  definition: string;
  criteriaSummary: string;
  status: 'green' | 'yellow' | 'red';
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  insight: string;
  decisionSignals: Array<{ text: string; sentiment: 'positive' | 'negative' | 'neutral' }>;
  sources: Array<{ source_title: string; source_type: string; evidence_doc_id: string }>;
  assessments?: Array<{ instance_id: string; assessment_id: string; display_name: string }>;
  suggestedImprovement?: string | null;
}): ProjectStatusResponse['categories'][number] {
  const positives = input.decisionSignals.filter((s) => s.sentiment === 'positive').map((s) => s.text);
  const negatives = input.decisionSignals.filter((s) => s.sentiment === 'negative').map((s) => s.text);
  const neutrals = input.decisionSignals.filter((s) => s.sentiment === 'neutral').map((s) => s.text);

  return {
    category_key: input.key,
    label: input.label,
    definition_text: input.definition,
    criteria_summary: input.criteriaSummary,
    status: input.status,
    effective_status: input.status,
    confidence: input.confidence,
    rationale: input.rationale,
    critical_insight: input.insight,
    decision_signals: input.decisionSignals.slice(0, 5),
    supporting_evidence: positives.slice(0, 3),
    suggested_improvement: input.suggestedImprovement ?? null,
    retrieved_sources: input.sources,
    positive_drivers: positives,
    negative_drivers: negatives,
    blockers: [],
    missing_items: neutrals.filter((t) => t.toLowerCase().startsWith('no ') || t.toLowerCase().includes('not yet')),
    relevant_modules: (input.assessments ?? []).map((a) => a.assessment_id),
    relevant_module_names: (input.assessments ?? []).map((a) => a.display_name),
    relevant_assessments: input.assessments ?? [],
    improvement_actions: input.suggestedImprovement ? [input.suggestedImprovement] : [],
    uncertainties: neutrals.filter((t) => t.toLowerCase().includes('remain') || t.toLowerCase().includes('still')),
    update_source: 'demo',
    last_updated_at: NOW,
    is_stale: false,
    has_override: false,
    overrides: [],
  };
}

export const demoProjectStatus: ProjectStatusResponse = {
  domain: 'energy',
  project_id: DEMO_PROJECT_ID,
  stale: false,
  categories: [
    statusCategory({
      key: 'evidence_credibility',
      label: 'Evidence & credibility',
      definition:
        'Material claims are backed by traceable sources, with no major contradictions in the project record.',
      criteriaSummary: 'Checks whether core claims are supported by indexed project materials.',
      status: 'green',
      confidence: 'high',
      rationale: 'Feasibility, ESIA, SLD, and geotech packages form a coherent, citeable record.',
      insight: 'Evidence base is strong enough for diligence review.',
      decisionSignals: [
        {
          text: 'Feasibility study, ESIA, SLD, and geotech report are indexed and cross-reference cleanly',
          sentiment: 'positive',
        },
        {
          text: 'Indicative PPA term sheet is on file with pricing and tenor assumptions',
          sentiment: 'positive',
        },
        {
          text: 'No material contradictions found across the primary technical and commercial packages',
          sentiment: 'positive',
        },
        {
          text: 'Independent engineer review memo is not yet in the materials',
          sentiment: 'neutral',
        },
      ],
      sources: [
        {
          source_title: 'Rift Valley Solar Feasibility Study v3',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-feasibility',
        },
        {
          source_title: 'ESIA Nakuru Solar Storage 2026',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-esia',
        },
        {
          source_title: 'Geotechnical Report Site A',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-geo',
        },
      ],
    }),
    statusCategory({
      key: 'technical_viability',
      label: 'Technical viability',
      definition:
        'The proposed design and modeled outputs are coherent for this site and use case.',
      criteriaSummary: 'Checks design coherence, resource quality, and modeled plant performance.',
      status: 'green',
      confidence: 'high',
      rationale: 'Resource, SLD, and geotech packages support the 40 MW + 4h BESS design.',
      insight: 'No critical technical gaps for FEED handoff.',
      decisionSignals: [
        {
          text: 'On-site resource campaign supports a P50 capacity factor near 22% for the Nakuru site',
          sentiment: 'positive',
        },
        {
          text: 'Single-line diagram and BESS sizing align with the 40 MW / 160 MWh design basis',
          sentiment: 'positive',
        },
        {
          text: 'Geotech notes expansive clays but foundation redesign stays within the leased footprint',
          sentiment: 'positive',
        },
        {
          text: 'Final EPC pricing and equipment vendor shortlist remain unconfirmed',
          sentiment: 'neutral',
        },
      ],
      sources: [
        {
          source_title: 'Rift Valley Solar Feasibility Study v3',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-feasibility',
        },
        {
          source_title: 'Single Line Diagram 40MW BESS',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-sld',
        },
        {
          source_title: 'Geotechnical Report Site A',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-geo',
        },
      ],
      assessments: [
        {
          instance_id: DEMO_INSTANCE_SOLAR,
          assessment_id: 'solar_estimate',
          display_name: 'Solar Production Estimate',
        },
        {
          instance_id: DEMO_INSTANCE_LCOE,
          assessment_id: 'lcoe_model',
          display_name: 'LCOE Model',
        },
      ],
    }),
    statusCategory({
      key: 'funding_economics',
      label: 'Funding & economics',
      definition:
        'Cost, revenue, and funding logic hang together and look directionally credible.',
      criteriaSummary: 'Checks cost, revenue, and funding coherence for investment readiness.',
      status: 'yellow',
      confidence: 'medium',
      rationale: 'Indicative PPA at $0.072/kWh exists; binding offtake and financing are not locked.',
      insight: 'Commercial path is credible but not closed for IC.',
      decisionSignals: [
        {
          text: 'Indicative KPLC PPA term sheet supports a workable tariff around $0.072/kWh',
          sentiment: 'positive',
        },
        {
          text: 'LCOE model and feasibility CAPEX assumptions are directionally consistent',
          sentiment: 'positive',
        },
        {
          text: 'No binding PPA has been signed yet',
          sentiment: 'neutral',
        },
        {
          text: 'Construction financing is not yet committed',
          sentiment: 'neutral',
        },
        {
          text: 'Credit committee pack is not yet assembled',
          sentiment: 'neutral',
        },
      ],
      sources: [
        {
          source_title: 'KPLC PPA Term Sheet Draft',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-ppa',
        },
        {
          source_title: 'Rift Valley Solar Feasibility Study v3',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-feasibility',
        },
      ],
      assessments: [
        {
          instance_id: DEMO_INSTANCE_LCOE,
          assessment_id: 'lcoe_model',
          display_name: 'LCOE Model',
        },
      ],
      suggestedImprovement: 'Advance KPLC negotiations toward a binding offtake before IC.',
    }),
    statusCategory({
      key: 'deployment_readiness',
      label: 'Deployment readiness',
      definition:
        'A credible path to build and operate exists, with owners and no unresolved blockers.',
      criteriaSummary: 'Checks build/operate path, owners, and unresolved delivery blockers.',
      status: 'yellow',
      confidence: 'medium',
      rationale: 'ESIA and implementation drafting are underway; construction sequencing is still open.',
      insight: 'Delivery path is plausible but not yet owner-locked.',
      decisionSignals: [
        {
          text: 'ESIA is complete and frames land, community, and reinstatement requirements',
          sentiment: 'positive',
        },
        {
          text: 'Implementation plan assessment is in draft and outlines major workstreams',
          sentiment: 'positive',
        },
        {
          text: 'Named EPC and O&M owners are not yet evidenced in the materials',
          sentiment: 'neutral',
        },
        {
          text: 'Detailed construction schedule and grid interconnection milestones remain incomplete',
          sentiment: 'neutral',
        },
      ],
      sources: [
        {
          source_title: 'ESIA Nakuru Solar Storage 2026',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-esia',
        },
        {
          source_title: 'Rift Valley Solar Feasibility Study v3',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-feasibility',
        },
      ],
      assessments: [
        {
          instance_id: DEMO_INSTANCE_IMPL,
          assessment_id: 'implementation_plan',
          display_name: 'Implementation Plan',
        },
      ],
      suggestedImprovement: 'Assign EPC/O&M owners and lock interconnection milestones.',
    }),
    statusCategory({
      key: 'risk_profile',
      label: 'Risk profile',
      definition:
        'Material risks are identified, owned, and mitigated for the most important items.',
      criteriaSummary: 'Checks whether material risks are identified, owned, and mitigated.',
      status: 'green',
      confidence: 'medium',
      rationale: 'ESIA and stakeholder work identify main risks; no unresolved high-severity items recorded.',
      insight: 'Risk picture is manageable for this stage, with community sequencing as the watch item.',
      decisionSignals: [
        {
          text: 'ESIA and stakeholder assessment identify land, community, and geotech risks with mitigation paths',
          sentiment: 'positive',
        },
        {
          text: 'No unresolved high-severity risks are recorded in project signals',
          sentiment: 'positive',
        },
        {
          text: 'Community engagement sequencing is still in progress ahead of construction',
          sentiment: 'neutral',
        },
      ],
      sources: [
        {
          source_title: 'ESIA Nakuru Solar Storage 2026',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-esia',
        },
        {
          source_title: 'Geotechnical Report Site A',
          source_type: 'evidence',
          evidence_doc_id: 'demo-mat-geo',
        },
      ],
      assessments: [
        {
          instance_id: DEMO_INSTANCE_STAKEHOLDER,
          assessment_id: 'stakeholder_assessment',
          display_name: 'Stakeholder Assessment',
        },
        {
          instance_id: DEMO_INSTANCE_CARBON,
          assessment_id: 'carbon_model',
          display_name: 'Carbon Calculator',
        },
      ],
    }),
  ],
};

/** Hide sidebar usage pill — billing UI is for real accounts only. */
export const demoBillingStatus: BillingStatus = {
  allowed: true,
  tier: 'none',
  used_usd: 0,
  limit_usd: 0,
  trial_messages_remaining: null,
  access_code_redeemed: false,
  access_code_available: false,
  status: 'active',
  byok_providers: [],
};

/** Extracted-text previews for demo file opens (no real binary downloads). */
export function demoEvidenceChunks(evidenceId: string): {
  id: string;
  filename: string | null;
  file_type: string | null;
  chunks: Array<{ id: string; chunk_index: number; content: string; page_number?: number | null }>;
} | null {
  const material = demoMaterials.find((m) => m.id === evidenceId);
  if (!material) return null;
  const excerpts: Record<string, string> = {
    'demo-mat-feasibility':
      'Rift Valley Solar — Feasibility Study (v3)\n\n'
      + '1. Executive summary\n'
      + 'The proposed 40 MWAC photovoltaic plant with 40 MW / 160 MWh BESS in Nakuru County '
      + 'is technically feasible based on a 12-month on-site resource campaign. P50 capacity '
      + 'factor is 22%. Indicative all-in CAPEX is approximately USD 1,100/kW.\n\n'
      + '2. Resource assessment\n'
      + 'Pyranometer and satellite cross-checks support a P50 yield of ~77 GWh/year before storage losses.',
    'demo-mat-ppa':
      'KPLC — Indicative PPA Term Sheet (Draft)\n\n'
      + 'Offtaker: Kenya Power and Lighting Company\n'
      + 'Term: 20 years from COD\n'
      + 'Tariff: USD 0.072/kWh, USD-linked, CPI-US escalation with 2% floor\n'
      + 'Delivery: 132 kV interconnection; take-or-pay energy with availability liquidated damages.',
    'demo-mat-esia':
      'Environmental & Social Impact Assessment — Nakuru Solar + Storage (2026)\n\n'
      + 'Priority stakeholders: county administration and NEMA; adjacent community committees '
      + 'along the access road; KPLC interconnection counterparts. Livelihood impacts concentrate '
      + 'near the northern grazing corridor. Construction footprint remains within the leased site.',
    'demo-mat-sld':
      'Single-Line Diagram — 40 MW PV + 4h BESS\n\n'
      + 'PV array → inverters → 33 kV collector → step-up to 132 kV → KPLC POI.\n'
      + 'BESS DC coupled on designated blocks; charged exclusively from on-site PV.\n'
      + 'Protection and metering per Kenyan grid code interconnection requirements.',
    'demo-mat-geo':
      'Geotechnical Report — Site A\n\n'
      + 'Subsurface: residual soils over weathered volcanic rock. Localized expansive clays '
      + 'noted in the northern pad; foundation design uses over-excavation and engineered fill. '
      + 'No resettlement implications from foundation redesign.',
  };
  const content = excerpts[evidenceId]
    ?? `Demo preview for ${material.filename}.\n\nFull binary download is disabled in demo mode.`;
  return {
    id: evidenceId,
    filename: material.filename,
    // Text path avoids binary download (raw fetch is not mocked in demo).
    file_type: 'text',
    chunks: [
      {
        id: `${evidenceId}-chunk-0`,
        chunk_index: 0,
        content,
        page_number: 1,
      },
    ],
  };
}

export function demoEvidenceContent(evidenceId: string): {
  id: string;
  filename: string | null;
  file_type: string | null;
  content: string;
  chunk_count: number;
} | null {
  const chunks = demoEvidenceChunks(evidenceId);
  if (!chunks) return null;
  return {
    id: chunks.id,
    filename: chunks.filename,
    file_type: chunks.file_type,
    content: chunks.chunks.map((c) => c.content).join('\n\n'),
    chunk_count: chunks.chunks.length,
  };
}

function approvedFinal() {
  return {
    status: 'approved' as const,
    approved_at: WEEK_AGO,
    approved_by: DEMO_USER_ID,
    approved_by_email: DEMO_OWNER_EMAIL,
  };
}

function confirmedStage(data: StageStateData): {
  status: 'confirmed';
  confirmed_at: string;
  confirmed_by: string;
  confirmed_by_email: string;
  data: StageStateData;
} {
  return {
    status: 'confirmed',
    confirmed_at: WEEK_AGO,
    confirmed_by: DEMO_USER_ID,
    confirmed_by_email: DEMO_OWNER_EMAIL,
    data,
  };
}

type StageStateData = {
  items?: Array<{
    id: string;
    content: Record<string, unknown>;
    origin: 'provided' | 'inferred' | 'assumed';
    provenance: { derivation: string; sources: []; rationale: string };
    confirmed: boolean;
    confirmed_at: string;
    removable: boolean;
  }>;
  records?: Record<string, Record<string, unknown>>;
  widget_data?: Record<string, unknown>;
};

function listItem(id: string, content: Record<string, unknown>) {
  return {
    id,
    content,
    origin: 'provided' as const,
    provenance: { derivation: 'demo', sources: [] as [], rationale: 'Demo fixture' },
    confirmed: true,
    confirmed_at: WEEK_AGO,
    removable: false,
  };
}

function lcoeInputRow(
  id: string,
  fieldName: string,
  variable: string,
  value: number | string,
  unit: string,
  category: string,
) {
  return {
    id,
    content: {
      field_name: fieldName,
      variable,
      value,
      unit,
      category,
      status: 'validated',
    },
    origin: 'provided' as const,
    provenance: { derivation: 'demo', sources: [] as [], rationale: 'Demo fixture' },
    confirmed: true,
    confirmed_at: WEEK_AGO,
    removable: false,
  };
}

function lcoeWidgetInput(
  fieldName: string,
  label: string,
  value: number | string,
  unit: string,
  category: string,
) {
  return {
    field_name: fieldName,
    label,
    value,
    unit,
    source: 'user',
    status: 'validated',
    notes: '',
    rationale: '',
    category,
    field_type: typeof value === 'number' ? 'number' : 'text',
    validation_status: 'ok',
  };
}

/** Static completed LCOE workflow — matches real editable_table + lcoe_results shapes. */
export function buildLcoeWorkflowState(): StagedAssessmentWorkflowState {
  const inputItems = [
    lcoeInputRow('in-tech', 'technology_type', 'Technology type', 'solar_pv', '', 'project'),
    lcoeInputRow('in-cap', 'net_capacity_kw', 'Net capacity', 40000, 'kW', 'project'),
    lcoeInputRow('in-cf', 'capacity_factor', 'Capacity factor', 0.22, 'fraction', 'energy'),
    lcoeInputRow('in-capex', 'total_capex', 'Total CAPEX', 44_000_000, 'USD', 'costs'),
    lcoeInputRow('in-opex', 'annual_opex', 'Annual O&M', 720_000, 'USD/yr', 'costs'),
    lcoeInputRow('in-fuel', 'annual_fuel_cost', 'Annual fuel cost', 0, 'USD/yr', 'costs'),
    lcoeInputRow('in-disc', 'discount_rate', 'Discount rate / WACC', 0.08, 'fraction', 'finance'),
    lcoeInputRow('in-life', 'project_life_years', 'Project lifetime', 25, 'years', 'timing'),
    lcoeInputRow('in-deg', 'degradation_rate', 'Degradation rate', 0.005, 'fraction', 'energy'),
    lcoeInputRow('in-curr', 'currency', 'Currency', 'USD', '', 'general'),
  ];

  const widgetInputs = {
    technology_type: lcoeWidgetInput('technology_type', 'Technology type', 'solar_pv', '', 'project'),
    net_capacity_kw: lcoeWidgetInput('net_capacity_kw', 'Net capacity', 40000, 'kW', 'project'),
    capacity_factor: lcoeWidgetInput('capacity_factor', 'Capacity factor', 0.22, 'fraction', 'energy'),
    total_capex: lcoeWidgetInput('total_capex', 'Total CAPEX', 44_000_000, 'USD', 'costs'),
    annual_opex: lcoeWidgetInput('annual_opex', 'Annual O&M', 720_000, 'USD/yr', 'costs'),
    annual_fuel_cost: lcoeWidgetInput('annual_fuel_cost', 'Annual fuel cost', 0, 'USD/yr', 'costs'),
    discount_rate: lcoeWidgetInput('discount_rate', 'Discount rate / WACC', 0.08, 'fraction', 'finance'),
    project_life_years: lcoeWidgetInput('project_life_years', 'Project lifetime', 25, 'years', 'timing'),
    degradation_rate: lcoeWidgetInput('degradation_rate', 'Degradation rate', 0.005, 'fraction', 'energy'),
    currency: lcoeWidgetInput('currency', 'Currency', 'USD', '', 'general'),
  };

  return {
    instance_id: DEMO_INSTANCE_LCOE,
    assessment_id: 'lcoe_model',
    status: 'complete',
    workflow_version: 3,
    workflow_state: {
      assessment_type: 'lcoe_model',
      current_stage_id: 'results',
      stages: {
        inputs: confirmedStage({ items: inputItems }),
        results: confirmedStage({
          widget_data: {
            inputs: widgetInputs,
            missing_essentials: [],
            computable: true,
            technology_type: 'solar_pv',
            result: {
              lcoe: 0.0537,
              currency: 'USD',
              npv_total_costs: 53_006_082,
              npv_total_energy: 987_610_700,
              capex_share: 0.85,
              opex_share: 0.15,
              fuel_share: 0,
              replacement_share: 0,
              lifetime_energy_kwh: 2_269_851_478,
              variable_count: 10,
              quality_label: 'high',
              cash_flows: [],
            },
            sensitivity: [
              {
                param_name: 'total_capex',
                param_label: 'Total CAPEX',
                base_value: 44_000_000,
                test_value: 48_400_000,
                lcoe: 0.0581,
              },
              {
                param_name: 'capacity_factor',
                param_label: 'Capacity Factor',
                base_value: 0.22,
                test_value: 0.2,
                lcoe: 0.0591,
              },
              {
                param_name: 'discount_rate',
                param_label: 'Discount Rate',
                base_value: 0.08,
                test_value: 0.1,
                lcoe: 0.0604,
              },
            ],
          },
        }),
      },
      final_approval: approvedFinal(),
      user_engaged: true,
    },
    assessment_definition: {
      id: 'lcoe_model',
      name: 'LCOE Model',
      description: 'Levelized cost of energy for the solar + storage plant.',
      icon: '⚡',
      output_type: 'lcoe',
      category: 'technical',
      export_format: 'xlsx',
      requires_final_approval: true,
      stage_defs: [
        {
          id: 'inputs',
          title: 'Inputs',
          component: 'table',
          widget: 'editable_table',
          allow_add_rows: false,
          fields: [
            { name: 'variable', field_type: 'text', required: true, label: 'Variable', options: null, placeholder: null },
            { name: 'value', field_type: 'number', required: false, label: 'Value', options: null, placeholder: null },
            { name: 'unit', field_type: 'text', required: false, label: 'Unit', options: null, placeholder: null },
          ],
          population: [],
        },
        {
          id: 'results',
          title: 'Results',
          component: 'computed_results',
          widget: 'lcoe_results',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
      ],
    },
  };
}

/** Static completed carbon workflow — full grid_renewable pack (matches CarbonEngine._grid_renewable_fields). */
export function buildCarbonWorkflowState(): StagedAssessmentWorkflowState {
  // 40 MW × 22% CF × 8760 → 77,088 MWh/yr; × 0.48 tCO2e/MWh → ~37,002 tCO2e year-1.
  const year1Baseline = 37_002.24;
  const erSchedule = Array.from({ length: 25 }, (_, i) => {
    const year = i + 1;
    const genMwh = 40_000 * 0.22 * 8760 * (1 - 0.005) ** (year - 1) / 1000;
    const baseline = genMwh * 0.48;
    return {
      year,
      devices: 1,
      baseline_emissions: Math.round(baseline * 100) / 100,
      project_emissions: 0,
      leakage: 0,
      net_er: Math.round(baseline * 100) / 100,
    };
  });

  const inputItems = [
    lcoeInputRow('in-pack', 'method_pack', 'Project Type', 'grid_renewable', '', 'general'),
    lcoeInputRow('in-tech', 'renewable_tech', 'Renewable Technology', 'solar_pv', '', 'project'),
    lcoeInputRow('in-model', 'generation_model', 'Generation Model', 'grid_export', '', 'project'),
    lcoeInputRow('in-cap', 'installed_capacity_kw', 'Installed Capacity', 40_000, 'kW', 'activity'),
    lcoeInputRow('in-cf', 'capacity_factor', 'Capacity Factor', 0.22, '', 'activity'),
    lcoeInputRow('in-deg', 'annual_degradation', 'Annual Degradation', 0.005, '', 'activity'),
    lcoeInputRow('in-ef', 'grid_emission_factor', 'Grid Emission Factor', 0.48, 'tCO₂/MWh', 'baseline'),
    lcoeInputRow('in-aux', 'auxiliary_consumption_pct', 'Auxiliary / Parasitic Consumption', 0, '', 'project'),
    lcoeInputRow('in-td', 'td_losses_pct', 'T&D Losses (end-use displacement only)', 0, '', 'baseline'),
    lcoeInputRow('in-leak', 'leakage_factor', 'Leakage Factor', 0, '', 'leakage'),
    lcoeInputRow('in-years', 'crediting_period_years', 'Crediting Period', 25, 'years', 'general'),
  ];

  const widgetInputs = Object.fromEntries(
    inputItems.map((item) => {
      const c = item.content;
      return [
        c.field_name,
        lcoeWidgetInput(c.field_name, c.variable, c.value, c.unit, c.category),
      ];
    }),
  );

  return {
    instance_id: DEMO_INSTANCE_CARBON,
    assessment_id: 'carbon_model',
    status: 'complete',
    workflow_version: 2,
    workflow_state: {
      assessment_type: 'carbon_model',
      current_stage_id: 'results',
      stages: {
        inputs: confirmedStage({ items: inputItems }),
        results: confirmedStage({
          widget_data: {
            inputs: widgetInputs,
            missing_essentials: [],
            computable: true,
            method_pack: 'grid_renewable',
            result: {
              baseline_emissions_tco2e: year1Baseline,
              project_emissions_tco2e: 0,
              leakage_tco2e: 0,
              net_er_tco2e: year1Baseline,
              period: 'annual',
              baseline_share: 1,
              project_share: 0,
              leakage_share: 0,
              period_years: 25,
              variable_count: 11,
              quality_label: 'high',
              er_schedule: erSchedule,
            },
            sensitivity: [],
          },
        }),
      },
      final_approval: approvedFinal(),
      user_engaged: true,
    },
    assessment_definition: {
      id: 'carbon_model',
      name: 'Carbon Calculator',
      description: 'Grid displacement and lifetime abatement.',
      icon: '🌿',
      output_type: 'carbon',
      category: 'climate',
      export_format: 'xlsx',
      requires_final_approval: true,
      stage_defs: [
        {
          id: 'inputs',
          title: 'Inputs',
          component: 'table',
          widget: 'editable_table',
          allow_add_rows: false,
          fields: [
            { name: 'variable', field_type: 'text', required: true, label: 'Variable', options: null, placeholder: null },
            { name: 'value', field_type: 'number', required: false, label: 'Value', options: null, placeholder: null },
            { name: 'unit', field_type: 'text', required: false, label: 'Unit', options: null, placeholder: null },
          ],
          population: [],
        },
        {
          id: 'results',
          title: 'Results',
          component: 'computed_results',
          widget: 'carbon_results',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
      ],
    },
  };
}

/** Static completed solar workflow — matches editable_table + solar_yield_results shapes. */
export function buildSolarWorkflowState(): StagedAssessmentWorkflowState {
  // 40 MWAC ≈ 48 MWdc at 1.2 DC/AC; year-1 AC ≈ 77 GWh at ~22% CF (aligned with LCOE/carbon fixtures).
  const annualAc = 77_088_000;
  const monthlyWeights = [1.05, 1.02, 1.08, 0.98, 0.92, 0.82, 0.78, 0.84, 0.9, 0.96, 0.9, 0.95];
  const weightSum = monthlyWeights.reduce((sum, w) => sum + w, 0);
  const acMonthly = monthlyWeights.map((w) => Math.round((annualAc * w) / weightSum));
  const dcMonthly = acMonthly.map((v) => Math.round(v * 1.05));
  const solradMonthly = [6.2, 6.0, 6.4, 5.9, 5.5, 5.0, 4.8, 5.1, 5.4, 5.7, 5.4, 5.8];
  const poaMonthly = solradMonthly.map((v) => Math.round(v * 30.4 * 10) / 10);

  const inputItems = [
    lcoeInputRow('in-addr', 'address', 'Address', 'Nakuru County, Kenya', '', 'location'),
    lcoeInputRow('in-lat', 'lat', 'Latitude', -0.3031, '°', 'location'),
    lcoeInputRow('in-lon', 'lon', 'Longitude', 36.08, '°', 'location'),
    lcoeInputRow('in-cap', 'system_capacity', 'System Capacity', 48_000, 'kW DC', 'system'),
    lcoeInputRow('in-mod', 'assessment_type', 'Module Type', 0, '', 'system'),
    lcoeInputRow('in-arr', 'array_type', 'Array Type', 0, '', 'system'),
    lcoeInputRow('in-tilt', 'tilt', 'Tilt Angle', 10, '°', 'orientation'),
    lcoeInputRow('in-az', 'azimuth', 'Azimuth', 0, '°', 'orientation'),
    lcoeInputRow('in-loss', 'losses', 'System Losses', 14, '%', 'performance'),
    lcoeInputRow('in-dcr', 'dc_ac_ratio', 'DC/AC Ratio', 1.2, '', 'performance'),
    lcoeInputRow('in-inv', 'inv_eff', 'Inverter Efficiency', 96, '%', 'performance'),
    lcoeInputRow('in-gcr', 'gcr', 'Ground Coverage Ratio', 0.4, '', 'performance'),
  ];

  const widgetInputs = Object.fromEntries(
    inputItems.map((item) => {
      const c = item.content;
      return [
        c.field_name,
        lcoeWidgetInput(c.field_name, c.variable, c.value, c.unit, c.category),
      ];
    }),
  );

  return {
    instance_id: DEMO_INSTANCE_SOLAR,
    assessment_id: 'solar_estimate',
    status: 'complete',
    workflow_version: 2,
    workflow_state: {
      assessment_type: 'solar_estimate',
      current_stage_id: 'results',
      stages: {
        inputs: confirmedStage({ items: inputItems }),
        results: confirmedStage({
          widget_data: {
            inputs: widgetInputs,
            missing_essentials: [],
            computable: true,
            result: {
              ac_annual: annualAc,
              capacity_factor: 22.0,
              ac_monthly: acMonthly,
              dc_monthly: dcMonthly,
              solrad_monthly: solradMonthly,
              poa_monthly: poaMonthly,
              solrad_annual: solradMonthly.reduce((a, b) => a + b, 0) / 12,
              quality_label: 'high',
            },
          },
        }),
      },
      final_approval: approvedFinal(),
      user_engaged: true,
    },
    assessment_definition: {
      id: 'solar_estimate',
      name: 'Solar Production Estimate',
      description: 'Annual and monthly PV yield for the Nakuru site.',
      icon: '☀️',
      output_type: 'solar',
      category: 'technical',
      export_format: 'xlsx',
      requires_final_approval: true,
      stage_defs: [
        {
          id: 'inputs',
          title: 'Inputs',
          component: 'table',
          widget: 'editable_table',
          allow_add_rows: false,
          fields: [
            { name: 'variable', field_type: 'text', required: true, label: 'Variable', options: null, placeholder: null },
            { name: 'value', field_type: 'number', required: false, label: 'Value', options: null, placeholder: null },
            { name: 'unit', field_type: 'text', required: false, label: 'Unit', options: null, placeholder: null },
          ],
          population: [],
        },
        {
          id: 'results',
          title: 'Results',
          component: 'computed_results',
          widget: 'solar_yield_results',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
      ],
    },
  };
}

/** Completed stakeholder assessment — categories, profiles, and assessment_map. */
export function buildDemoStakeholderRecords(): Record<string, Record<string, unknown>> {
  const esiaSources = [
    {
      title: 'ESIA Nakuru Solar Storage 2026',
      url: null,
      publisher: null,
    },
  ];
  return {
    'sh-nema': {
      influence_level: 'High',
      impact_level: 'High',
      engagement_priority: 'Collaborate',
      role_in_project: 'Environmental regulator',
      notes:
        'NEMA is the lead authority for ESIA approval and post-approval compliance. Expect conditions on construction-phase monitoring, grievance redress, and biodiversity safeguards along the northern grazing corridor. Close ESIA conditions before financial close, and schedule compliance inspections ahead of fencing mobilization.',
      sources: esiaSources,
    },
    'sh-county': {
      influence_level: 'High',
      impact_level: 'Medium',
      engagement_priority: 'Collaborate',
      role_in_project: 'Host government',
      notes:
        'Nakuru County Administration controls land-use permits, access-road coordination, and local liaison protocols. Brief county leadership before fencing and keep a standing channel for community complaints routed through county officers.',
      sources: esiaSources,
    },
    'sh-committees': {
      influence_level: 'Medium',
      impact_level: 'High',
      engagement_priority: 'Consult',
      role_in_project: 'Affected community',
      notes:
        'Adjacent community committees represent households along the access road. Prioritize traffic safety, employment expectations, and a clear grievance mechanism before construction traffic peaks.',
      sources: esiaSources,
    },
    'sh-grazing': {
      influence_level: 'Medium',
      impact_level: 'High',
      engagement_priority: 'Consult',
      role_in_project: 'Livelihood users',
      notes:
        'Seasonal pastoral users of the northern grazing corridor are most exposed to fencing and construction footprint. Negotiate seasonal access agreements and mark corridor edges in the site layout before mobilization.',
      sources: esiaSources,
    },
    'sh-kplc': {
      influence_level: 'High',
      impact_level: 'High',
      engagement_priority: 'Collaborate',
      role_in_project: 'Offtaker',
      notes:
        'KPLC is the PPA counterparty and distribution interconnection operator. The current term sheet is non-binding — keep commercial negotiation and interconnection studies on parallel tracks so tariff assumptions stay aligned with LCOE.',
      sources: esiaSources,
    },
    'sh-ketraco': {
      influence_level: 'Medium',
      impact_level: 'Medium',
      engagement_priority: 'Inform',
      role_in_project: 'Transmission counterpart',
      notes:
        'KETRACO interfaces on evacuation into the national grid. Align the Single Line Diagram and interconnection request with their planning window to avoid late redesign of switchyard scope.',
      sources: esiaSources,
    },
    'sh-dfi': {
      influence_level: 'High',
      impact_level: 'Medium',
      engagement_priority: 'Inform',
      role_in_project: 'Senior lenders',
      notes:
        'The DFI lending consortium will diligence ESIA closure, stakeholder engagement logs, and grievance mechanism effectiveness before committing senior debt. Keep a decision-ready engagement register for IC review.',
      sources: esiaSources,
    },
  };
}

/** Map-inspector enrich payload — already-complete deep dive for demo stakeholders. */
export function getDemoStakeholderEnrichment(itemId: string): {
  item_id: string;
  record: Record<string, unknown>;
  workflow_version: number;
} | null {
  const record = buildDemoStakeholderRecords()[itemId];
  if (!record) return null;
  return {
    item_id: itemId,
    record,
    workflow_version: 2,
  };
}

/** Completed stakeholder assessment — categories, profiles, and assessment_map. */
export function buildStakeholderWorkflowState(): StagedAssessmentWorkflowState {
  const catGov = listItem('cat-gov', {
    label: 'Government & regulators',
    description: 'County administration, national environment, and permitting authorities.',
    icon: 'Landmark',
  });
  const catCommunity = listItem('cat-community', {
    label: 'Community & civil society',
    description: 'Adjacent settlements, grazing corridor committees, and local NGOs.',
    icon: 'Users',
  });
  const catGrid = listItem('cat-grid', {
    label: 'Grid & offtake',
    description: 'Interconnection and power purchase counterparties.',
    icon: 'Zap',
  });
  const catFinance = listItem('cat-finance', {
    label: 'Finance & lenders',
    description: 'DFI senior debt and sponsor equity stakeholders.',
    icon: 'Building2',
  });

  const shNema = listItem('sh-nema', {
    name: 'NEMA',
    category: 'Government & regulators',
    why_they_matter: 'Issues ESIA approvals and monitors environmental compliance conditions.',
  });
  const shCounty = listItem('sh-county', {
    name: 'Nakuru County Administration',
    category: 'Government & regulators',
    why_they_matter: 'Controls land-use permits, access-road coordination, and community liaison protocols.',
  });
  const shCommittees = listItem('sh-committees', {
    name: 'Adjacent community committees',
    category: 'Community & civil society',
    why_they_matter: 'Represent households along the access road and northern grazing corridor livelihoods.',
  });
  const shGrazing = listItem('sh-grazing', {
    name: 'Northern grazing corridor users',
    category: 'Community & civil society',
    why_they_matter: 'Seasonal pastoral users most exposed to fencing and construction footprint impacts.',
  });
  const shKplc = listItem('sh-kplc', {
    name: 'Kenya Power (KPLC)',
    category: 'Grid & offtake',
    why_they_matter: 'PPA counterparty and grid interconnection operator for export.',
  });
  const shKetraco = listItem('sh-ketraco', {
    name: 'KETRACO',
    category: 'Grid & offtake',
    why_they_matter: 'Transmission planning interface for evacuation into the national grid.',
  });
  const shDfi = listItem('sh-dfi', {
    name: 'DFI lending consortium',
    category: 'Finance & lenders',
    why_they_matter: 'Senior debt providers requiring ESIA closure and stakeholder engagement evidence.',
  });

  const stakeholderItems = [shNema, shCounty, shCommittees, shGrazing, shKplc, shKetraco, shDfi];
  const esiaSource = {
    title: 'ESIA Nakuru Solar Storage 2026',
    url: null as string | null,
  };
  const records = buildDemoStakeholderRecords();

  const pillarColors = ['#005e72', '#1a7340', '#c05621', '#1d4ed8'];
  const categoryItems = [catGov, catCommunity, catGrid, catFinance];
  const mapGroups = categoryItems.map((cat, idx) => {
    const label = String(cat.content.label);
    const items = stakeholderItems
      .filter((s) => s.content.category === label)
      .map((s) => {
        const record = records[s.id] ?? {};
        return {
          id: s.id,
          name: s.content.name,
          description: s.content.why_they_matter,
          category: label,
          influence_level: record.influence_level ?? '',
          impact_level: record.impact_level ?? '',
          engagement_priority: record.engagement_priority ?? '',
          role_in_project: record.role_in_project ?? '',
          notes: record.notes ?? '',
          provenance: {
            derivation: 'retrieval_grounded',
            sources: [esiaSource],
            rationale: 'Demo fixture grounded in ESIA priority stakeholders.',
          },
        };
      });
    return {
      id: cat.id,
      label,
      icon: cat.content.icon,
      color: pillarColors[idx % pillarColors.length],
      items,
    };
  });

  return {
    instance_id: DEMO_INSTANCE_STAKEHOLDER,
    assessment_id: 'stakeholder_assessment',
    status: 'complete',
    workflow_version: 2,
    workflow_state: {
      assessment_type: 'stakeholder_assessment',
      current_stage_id: 'map',
      stages: {
        categories: confirmedStage({ items: categoryItems }),
        stakeholders: confirmedStage({ items: stakeholderItems, records }),
        map: confirmedStage({
          widget_data: {
            groups: mapGroups,
            assessment_id: 'stakeholder_assessment',
          },
        }),
      },
      final_approval: approvedFinal(),
      user_engaged: true,
    },
    assessment_definition: {
      id: 'stakeholder_assessment',
      name: 'Stakeholder Assessment',
      description: 'Identify, map, and profile key stakeholders for the project.',
      icon: '👥',
      output_type: 'assessment_document',
      category: 'assessment',
      export_format: 'docx',
      requires_final_approval: true,
      stage_defs: [
        {
          id: 'categories',
          title: 'Categories',
          component: 'list',
          widget: 'categorized_list',
          allow_add_rows: true,
          fields: [
            { name: 'label', field_type: 'text', required: true, label: 'Category', options: null, placeholder: null },
            { name: 'description', field_type: 'long_text', required: false, label: 'Description', options: null, placeholder: null },
          ],
          population: [],
        },
        {
          id: 'stakeholders',
          title: 'Stakeholders',
          component: 'list',
          widget: 'categorized_workspace',
          allow_add_rows: true,
          fields: [
            { name: 'name', field_type: 'text', required: true, label: 'Name', options: null, placeholder: null },
            { name: 'category', field_type: 'text', required: true, label: 'Category', options: null, placeholder: null },
            { name: 'why_they_matter', field_type: 'long_text', required: false, label: 'Why they matter', options: null, placeholder: null },
          ],
          population: [],
        },
        {
          id: 'map',
          title: 'Map',
          component: 'computed_results',
          widget: 'assessment_map',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
      ],
    },
  };
}

export function buildGenericWorkflowState(
  instanceId: string,
  assessmentId: string,
  name: string,
  complete: boolean,
): StagedAssessmentWorkflowState {
  return {
    instance_id: instanceId,
    assessment_id: assessmentId,
    status: complete ? 'complete' : 'started',
    workflow_version: 1,
    workflow_state: {
      assessment_type: assessmentId,
      current_stage_id: complete ? 'summary' : 'inputs',
      stages: {
        inputs: complete
          ? confirmedStage({ items: [] })
          : {
              status: 'draft',
              confirmed_at: null,
              confirmed_by: null,
              confirmed_by_email: null,
              data: { items: [] },
            },
        summary: complete
          ? confirmedStage({
              widget_data: { summary: `${name} demo results are available for review.` },
            })
          : {
              status: 'pending',
              confirmed_at: null,
              confirmed_by: null,
              confirmed_by_email: null,
              data: null,
            },
      },
      final_approval: complete
        ? approvedFinal()
        : {
            status: 'pending',
            approved_at: null,
            approved_by: null,
            approved_by_email: null,
          },
      user_engaged: true,
    },
    assessment_definition: {
      id: assessmentId,
      name,
      description: `${name} (demo)`,
      icon: '📋',
      output_type: 'document',
      category: 'general',
      export_format: null,
      requires_final_approval: true,
      stage_defs: [
        {
          id: 'inputs',
          title: 'Inputs',
          component: 'list',
          widget: 'list',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
        {
          id: 'summary',
          title: 'Summary',
          component: 'computed_results',
          widget: 'summary',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
      ],
    },
  };
}

export function demoAgentStatus(complete: boolean): AssessmentAgentStatus {
  return {
    run_state: complete ? 'approved' : 'needs_review',
    current_stage_id: complete ? null : 'inputs',
    current_action: null,
    last_summary: complete ? 'Assessment approved in demo fixtures.' : 'Waiting on user review (demo).',
    workflow_version: 1,
    can_resume: false,
  };
}

export function demoActivityLog(
  instanceId: string,
  assessmentId: string,
  complete: boolean,
): AssessmentActivityLog {
  return {
    assessment_instance_id: instanceId,
    assessment_id: assessmentId,
    run_state: complete ? 'approved' : 'needs_review',
    entries: [
      {
        sequence_number: 1,
        event_type: 'stage_confirmed',
        label: 'Inputs confirmed',
        stage_id: 'inputs',
        stage_title: 'Inputs',
        summary: 'Demo fixtures marked inputs confirmed.',
        occurred_at: WEEK_AGO,
        is_decision_point: true,
        kind: 'stage_confirmed',
      },
      {
        sequence_number: 2,
        event_type: complete ? 'approved' : 'needs_review',
        label: complete ? 'Final approval recorded' : 'Awaiting review',
        stage_id: null,
        stage_title: null,
        summary: complete ? 'Assessment approved in demo.' : 'Still in progress (demo).',
        occurred_at: WEEK_AGO,
        is_decision_point: true,
        kind: complete ? 'approved' : 'needs_review',
      },
    ],
  };
}

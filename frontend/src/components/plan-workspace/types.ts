import type { LucideIcon } from 'lucide-react';

export type PlanWorkspaceItemStatus = 'not_started' | 'in_progress' | 'complete';
export type PlanWorkspaceItemClassification = 'required' | 'optional' | 'unknown';
export type PlanWorkspaceItemKind = 'deliverable' | 'assessment';

export interface PlanWorkspaceItem {
  id: string;
  title: string;
  kind: PlanWorkspaceItemKind;
  classification: PlanWorkspaceItemClassification;
  status: PlanWorkspaceItemStatus;
  rationale?: string;
  groupId: string;
  groupName: string;
  phaseId?: string;
  phaseOrder?: number;
  userAdded?: boolean;
  supports?: string[];
  dependsOn?: string[];
}

export interface PlanWorkspaceGroup {
  id: string;
  name: string;
  summary?: string;
  icon?: string;
  items: PlanWorkspaceItem[];
}

export interface PlanWorkspacePhase {
  id: string;
  name: string;
  description?: string;
}

export interface PlanWorkspaceDisplayMode {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface PlanWorkspaceFilterOption {
  id: string;
  label: string;
  color?: string;
}

export interface PlanWorkspaceFilterConfig {
  id: string;
  label: string;
  allLabel: string;
  selectedOptionId: string | null;
  options: PlanWorkspaceFilterOption[];
}

export interface PlanWorkspaceProgressSegment {
  id: string;
  label: string;
  color: string;
  completed: number;
  total: number;
}

export interface PlanWorkspaceProgress {
  completed: number;
  total: number;
  percentage: number;
  segments: PlanWorkspaceProgressSegment[];
}

export interface PlanWorkspaceInspectorDocumentSource {
  title: string;
  evidenceDocId: string;
  chunkId?: string | null;
}

export interface PlanWorkspaceInspectorLinkSource {
  title: string;
  url?: string | null;
  publisher?: string | null;
}

export type PlanWorkspaceInspectorCitationSource =
  | ({
      key: string;
      label: string;
      type: 'document';
      citationNumber: number;
    } & PlanWorkspaceInspectorDocumentSource)
  | ({
      key: string;
      label: string;
      type: 'link';
      citationNumber: number;
    } & PlanWorkspaceInspectorLinkSource);

export interface PlanWorkspaceInspectorResult {
  summary: string[];
  summaryCitations?: number[][];
  summaryTitle?: string;
  requirements: Array<{
    title: string;
    description: string;
  }>;
  requirementsTitle?: string;
  dependencies: Array<{
    condition: string;
    effect: string;
  }>;
  dependenciesTitle?: string;
  detailFields?: Array<{
    label: string;
    value: string;
  }>;
  detailFieldsTitle?: string;
  documentSources: PlanWorkspaceInspectorDocumentSource[];
  documentSourcesTitle?: string;
  linkSources: PlanWorkspaceInspectorLinkSource[];
  linkSourcesTitle?: string;
  citationSources?: PlanWorkspaceInspectorCitationSource[];
  loadingLabel?: string;
  emptySourcesMessage?: string;
  latencyMs: number;
}

export interface PlanWorkspaceInspectorState {
  item: PlanWorkspaceItem;
  groupName: string;
  result: PlanWorkspaceInspectorResult | null;
  loading: boolean;
  error: string | null;
}

export interface PlanWorkspaceStructureOption {
  id: string;
  name: string;
  summary: string;
  icon?: string;
}

export interface PlanWorkspaceStructureConfirmAction {
  type: string;
}

export interface PlanWorkspaceStructureConfirmData {
  planType: string;
  title: string;
  subtitle: string;
  pendingTitle: string;
  pendingSubtitleTemplate: string;
  successMessage: string;
  footerHint: string;
  confirmLabel: string;
  minSelected: number;
  options: PlanWorkspaceStructureOption[];
  action: PlanWorkspaceStructureConfirmAction;
}

export interface PlanWorkspaceSummaryData {
  planType: string;
  title: string;
  subtitle?: string;
  footerText?: string;
  totalItems: number;
  requiredCount?: number;
  groups: Array<{
    id: string;
    name: string;
    itemCount: number;
    requiredCount?: number;
    icon?: string;
  }>;
}

export interface PlanWorkspaceAdapter {
  loadStructure: () => Promise<void>;
  confirmStructure: (options: PlanWorkspaceStructureOption[]) => Promise<void>;
  setItemStatus: (itemId: string, status: PlanWorkspaceItemStatus) => Promise<void>;
  addItem: (groupId: string, title: string, phaseId?: string) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  loadInspector: (item: PlanWorkspaceItem) => Promise<PlanWorkspaceInspectorResult | null>;
  deleteInspectorElement: (itemId: string, elementIndex: number) => Promise<void>;
}

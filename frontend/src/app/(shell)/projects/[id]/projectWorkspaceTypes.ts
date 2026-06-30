import type { WorkspacePanelTab } from '@/components/editor';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { PlanWorkspaceInspectorState } from '@/components/plan-workspace';
import type { FieldContext } from '@/lib/api';

export const MIN_CHAT_PANEL_PERCENT = 20;
export const MAX_CHAT_PANEL_PERCENT = 60;
export const DEFAULT_CHAT_PANEL_PERCENT = 30;

export type ProjectView = 'overview' | 'assessments' | 'framework' | 'assumptions' | 'files';

export function viewFromSearchParam(viewParam: string | null): ProjectView {
  if (viewParam === 'overview' || viewParam === 'research' || viewParam === 'explore') return 'overview';
  if (viewParam === 'framework' || viewParam === 'plan') return 'framework';
  if (viewParam === 'workspace' || viewParam === 'assessments') return 'assessments';
  if (viewParam === 'assumptions') return 'assumptions';
  if (viewParam === 'files') return 'files';
  return 'overview';
}

export function makeDocumentTabId(citation: ResearchPanelCitation): string {
  return `document-${citation.evidence_doc_id}`;
}

export interface PendingDeepDiveRequest {
  requestId: string;
  state: PlanWorkspaceInspectorState;
}

export interface PendingAssumptionsRequest {
  requestId: string;
  focusAssumptionId?: string | null;
  createNew?: boolean;
  title?: string | null;
  forceNewTab?: boolean;
  autoSend?: {
    requestId: string;
    content: string;
    toolHint?: string;
    fieldContext?: FieldContext | null;
    modelInputsContext?: string | null;
    assumptionId?: string | null;
  } | null;
}

export interface StoredProjectWorkspaceUiState {
  panelVisibility: {
    overview: { workspace: boolean; chat: boolean };
    assessments: { workspace: boolean; chat: boolean };
    framework: { workspace: boolean; chat: boolean };
    assumptions: { workspace: boolean; chat: boolean };
  };
  chatPanelWidthPercent: number;
  workspaceTabs: WorkspacePanelTab[];
  activeWorkspaceTabId: string | null;
}

export const DEFAULT_PANEL_VISIBILITY: StoredProjectWorkspaceUiState['panelVisibility'] = {
  overview: { workspace: true, chat: false },
  assessments: { workspace: true, chat: false },
  framework: { workspace: true, chat: false },
  assumptions: { workspace: true, chat: false },
};

export function readStoredWorkspaceUiState(storageKey: string): StoredProjectWorkspaceUiState | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProjectWorkspaceUiState>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.panelVisibility || !parsed.workspaceTabs) return null;

    const tabs = Array.isArray(parsed.workspaceTabs)
      ? parsed.workspaceTabs.filter(
          (tab): tab is WorkspacePanelTab =>
            Boolean(tab) &&
            typeof tab === 'object' &&
            typeof (tab as { id?: unknown }).id === 'string' &&
            typeof (tab as { title?: unknown }).title === 'string' &&
            typeof (tab as { kind?: unknown }).kind === 'string' &&
            (tab as { kind?: unknown }).kind !== 'artifacts',
        )
      : [];

    const parsedWidth = Number(parsed.chatPanelWidthPercent);
    const clampedWidth = Number.isFinite(parsedWidth)
      ? Math.min(MAX_CHAT_PANEL_PERCENT, Math.max(MIN_CHAT_PANEL_PERCENT, parsedWidth))
      : DEFAULT_CHAT_PANEL_PERCENT;

    const activeWorkspaceTabId =
      typeof parsed.activeWorkspaceTabId === 'string' &&
      tabs.some((tab) => tab.id === parsed.activeWorkspaceTabId)
        ? parsed.activeWorkspaceTabId
        : null;
    const rawPanelVisibility = parsed.panelVisibility as Partial<StoredProjectWorkspaceUiState['panelVisibility']>;
    const panelVisibility: StoredProjectWorkspaceUiState['panelVisibility'] = {
      overview: rawPanelVisibility?.overview ?? DEFAULT_PANEL_VISIBILITY.overview,
      assessments: rawPanelVisibility?.assessments ?? DEFAULT_PANEL_VISIBILITY.assessments,
      framework: rawPanelVisibility?.framework ?? DEFAULT_PANEL_VISIBILITY.framework,
      assumptions: rawPanelVisibility?.assumptions ?? DEFAULT_PANEL_VISIBILITY.assumptions,
    };

    return {
      panelVisibility,
      chatPanelWidthPercent: clampedWidth,
      workspaceTabs: tabs,
      activeWorkspaceTabId,
    };
  } catch {
    return null;
  }
}

export function writeStoredWorkspaceUiState(storageKey: string, state: StoredProjectWorkspaceUiState) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore private mode / quota errors.
  }
}

export function inspectorRequestKey(state: PlanWorkspaceInspectorState): string {
  return `${state.groupName}::${state.item.id}`;
}

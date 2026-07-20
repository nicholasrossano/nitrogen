import type { FloatWidget } from '@/components/editor/FloatLayer';

/** Soft cap — opening past this closes the least-recently-used non-active tab. */
export const FLOAT_TAB_HARD_CAP = 12;

/** How many inactive tabs FloatLayer may keep mounted (LRU). */
export const FLOAT_TAB_KEEP_ALIVE = 3;

/**
 * Stable session identity for dedupe / activate.
 * Assessment workspace, logs, and assessment-linked reports share one tab per instance.
 */
export function floatTabDedupeKey(widget: FloatWidget): string {
  if (
    widget.type === 'assessment_workspace'
    || widget.type === 'decision_log'
    || widget.type === 'activity_log'
  ) {
    const instanceId = widget.data?.instance_id;
    if (typeof instanceId === 'string' && instanceId) {
      return `assessment:${instanceId}`;
    }
  }

  if (widget.type === 'document_viewer') {
    const instanceId = widget.data?.instance_id;
    if (typeof instanceId === 'string' && instanceId) {
      return `assessment:${instanceId}`;
    }
    const evidenceId = widget.data?.evidence_doc_id;
    if (typeof evidenceId === 'string' && evidenceId) {
      return `document:${evidenceId}`;
    }
    const materialId = widget.data?.project_material_id;
    if (typeof materialId === 'string' && materialId) {
      return `material:${materialId}`;
    }
  }

  if (widget.type === 'variable_detail') {
    const variableId =
      (typeof widget.data?.variable?.id === 'string' && widget.data.variable.id)
      || (typeof widget.data?.assumption?.id === 'string' && widget.data.assumption.id)
      || null;
    if (variableId) return `variable:${variableId}`;
  }

  return widget.messageId;
}

export function findFloatTabIndex(tabs: FloatWidget[], tabId: string): number {
  return tabs.findIndex((tab) => floatTabDedupeKey(tab) === tabId);
}

export type OpenFloatTabResult = {
  tabs: FloatWidget[];
  activeTabId: string;
  /** Tab closed to enforce the hard cap (caller may run ephemeral cleanup). */
  evicted: FloatWidget | null;
};

/**
 * Browser-like open: activate existing identity, else append and activate.
 * Evicts the oldest non-active tab when over the hard cap.
 */
export function openFloatTabInSession(
  tabs: FloatWidget[],
  activeTabId: string | null,
  widget: FloatWidget,
  recentOrder: string[],
): OpenFloatTabResult {
  const tabId = floatTabDedupeKey(widget);
  const existingIndex = findFloatTabIndex(tabs, tabId);

  if (existingIndex >= 0) {
    const nextTabs = tabs.slice();
    nextTabs[existingIndex] = widget;
    return { tabs: nextTabs, activeTabId: tabId, evicted: null };
  }

  let nextTabs = [...tabs, widget];
  let evicted: FloatWidget | null = null;

  if (nextTabs.length > FLOAT_TAB_HARD_CAP) {
    const protectedIds = new Set([tabId, activeTabId].filter(Boolean) as string[]);
    const evictionCandidate =
      recentOrder.find((id) => {
        if (protectedIds.has(id)) return false;
        return findFloatTabIndex(nextTabs, id) >= 0;
      })
      ?? nextTabs
        .map((tab) => floatTabDedupeKey(tab))
        .find((id) => !protectedIds.has(id));

    if (evictionCandidate) {
      const idx = findFloatTabIndex(nextTabs, evictionCandidate);
      if (idx >= 0) {
        evicted = nextTabs[idx];
        nextTabs = nextTabs.filter((_, i) => i !== idx);
      }
    }
  }

  return { tabs: nextTabs, activeTabId: tabId, evicted };
}

export function replaceFloatTabInSession(
  tabs: FloatWidget[],
  activeTabId: string | null,
  widget: FloatWidget,
): { tabs: FloatWidget[]; activeTabId: string } {
  const nextId = floatTabDedupeKey(widget);
  if (!activeTabId || tabs.length === 0) {
    return { tabs: [widget], activeTabId: nextId };
  }

  const index = findFloatTabIndex(tabs, activeTabId);
  if (index < 0) {
    return { tabs: [...tabs, widget], activeTabId: nextId };
  }

  const nextTabs = tabs.slice();
  nextTabs[index] = widget;
  return { tabs: nextTabs, activeTabId: nextId };
}

export function closeFloatTabInSession(
  tabs: FloatWidget[],
  activeTabId: string | null,
  tabId: string,
): { tabs: FloatWidget[]; activeTabId: string | null; closed: FloatWidget | null } {
  const index = findFloatTabIndex(tabs, tabId);
  if (index < 0) {
    return { tabs, activeTabId, closed: null };
  }

  const closed = tabs[index];
  const nextTabs = tabs.filter((_, i) => i !== index);
  if (nextTabs.length === 0) {
    return { tabs: nextTabs, activeTabId: null, closed };
  }

  if (activeTabId !== tabId) {
    return { tabs: nextTabs, activeTabId, closed };
  }

  const fallback = nextTabs[Math.min(index, nextTabs.length - 1)];
  return {
    tabs: nextTabs,
    activeTabId: floatTabDedupeKey(fallback),
    closed,
  };
}

/** Touch tab id as most-recently-used (end of array = newest). */
export function touchFloatTabRecentOrder(recentOrder: string[], tabId: string): string[] {
  return [...recentOrder.filter((id) => id !== tabId), tabId];
}

/** Oldest-first ids for keep-alive eviction (exclude active). */
export function floatTabKeepAliveIds(
  recentOrder: string[],
  activeTabId: string | null,
  keepAlive: number = FLOAT_TAB_KEEP_ALIVE,
): Set<string> {
  const inactiveNewestFirst = [...recentOrder].reverse().filter((id) => id !== activeTabId);
  return new Set(inactiveNewestFirst.slice(0, keepAlive));
}

export interface PersistedFloatSession {
  tabs: FloatWidget[];
  activeTabId: string | null;
  recentOrder: string[];
}

const FLOAT_SESSION_STORAGE_PREFIX = 'nitrogen:float-session:';

function floatSessionStorageKey(projectId: string): string {
  return `${FLOAT_SESSION_STORAGE_PREFIX}${projectId}`;
}

function isFloatWidgetShape(value: unknown): value is FloatWidget {
  return (
    Boolean(value)
    && typeof value === 'object'
    && typeof (value as FloatWidget).type === 'string'
    && typeof (value as FloatWidget).messageId === 'string'
    && typeof (value as FloatWidget).data === 'object'
    && (value as FloatWidget).data !== null
  );
}

/**
 * Session-scoped (survives refresh, not shared across tabs/windows or after the browser
 * tab closes) so a hard refresh doesn't silently drop every open float tab except
 * whichever one happens to be mirrored in ?assessment=/?variable=.
 */
export function readPersistedFloatSession(projectId: string): PersistedFloatSession | null {
  if (typeof window === 'undefined' || !projectId) return null;
  try {
    const raw = window.sessionStorage.getItem(floatSessionStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedFloatSession> | null;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs.filter(isFloatWidgetShape);
    if (tabs.length === 0) return null;
    const activeTabId = typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null;
    const recentOrder = Array.isArray(parsed.recentOrder)
      ? parsed.recentOrder.filter((id): id is string => typeof id === 'string')
      : [];
    return { tabs, activeTabId, recentOrder };
  } catch {
    // Corrupt/old-shape storage should never block restoring the workbench.
    return null;
  }
}

export function writePersistedFloatSession(projectId: string, session: PersistedFloatSession): void {
  if (typeof window === 'undefined' || !projectId) return;
  try {
    if (session.tabs.length === 0) {
      window.sessionStorage.removeItem(floatSessionStorageKey(projectId));
      return;
    }
    window.sessionStorage.setItem(floatSessionStorageKey(projectId), JSON.stringify(session));
  } catch {
    // Storage full or unavailable (e.g. private browsing) — session just won't survive refresh.
  }
}

export function clearPersistedFloatSession(projectId: string): void {
  if (typeof window === 'undefined' || !projectId) return;
  try {
    window.sessionStorage.removeItem(floatSessionStorageKey(projectId));
  } catch {
    // ignore
  }
}

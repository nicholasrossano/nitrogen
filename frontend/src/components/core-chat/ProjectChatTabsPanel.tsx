'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { ProjectChatSurface } from './ProjectChatSurface';
import { DeepDiveWidget } from '@/components/plan-workspace/DeepDiveWidget';
import { AssumptionsChatPanel } from '@/components/assumptions/AssumptionsChatPanel';
import type {
  PlanWorkspaceInspectorDocumentSource,
  PlanWorkspaceInspectorState,
} from '@/components/plan-workspace';
import { Tooltip } from '@/components/ui/Tooltip';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { ResearchPanelCitation } from './ResearchPanel';
import { api } from '@/lib/api';
import type { ChatSession } from '@/types/chat';

interface ProjectChatTab {
  id: string;
  title: string;
  chatId: string | null;
  isLanding: boolean;
  /** True only for auto-created placeholder tabs. */
  isFallback: boolean;
}

interface PendingDeepDiveContext {
  requestId: string;
  state: PlanWorkspaceInspectorState;
  collapsed?: boolean;
  onOpenDocument?: (source: PlanWorkspaceInspectorDocumentSource) => void;
}

interface PendingAssumptionsContext {
  requestId: string;
  focusAssumptionId?: string | null;
  title?: string | null;
  collapsed?: boolean;
}

interface ProjectChatTabsPanelProps {
  initiativeId: string;
  researchMode?: boolean;
  sessionStorageKey?: string;
  resetToLandingSignal?: number;
  pendingChatToOpen?: { chatId: string; title?: string | null } | null;
  pendingAutoSend?: PendingAutoSendRequest | null;
  activeModuleContext?: { instanceId: string; moduleId: string; title?: string | null } | null;
  onPendingSessionHandled?: () => void;
  onPendingAutoSendHandled?: () => void;
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenWorkspaceModule?: (module: { instanceId: string; moduleId: string; title?: string | null }) => void;
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
  /** Fixed content rendered above the messages area in the active chat tab */
  topContent?: React.ReactNode;
  /** Creates or updates a chat tab with a pinned deep-dive widget */
  pendingDeepDive?: PendingDeepDiveContext | null;
  onPendingDeepDiveHandled?: () => void;
  /** Creates or updates a chat tab with a pinned assumptions panel */
  pendingAssumptions?: PendingAssumptionsContext | null;
  onPendingAssumptionsHandled?: () => void;
}

interface PendingAutoSendRequest {
  requestId: string;
  content: string;
  toolHint?: string;
}

function makeTab(title = 'New Chat', isLanding = false, isFallback = false): ProjectChatTab {
  return {
    id: `chat-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    chatId: null,
    isLanding,
    isFallback,
  };
}

interface StoredProjectChatTabsState {
  tabs: ProjectChatTab[];
  activeTabId: string | null;
  assumptionsByTabId?: Record<string, { focusAssumptionId?: string | null; collapsed?: boolean }>;
}

function normalizeProjectChatTabsState(
  state: StoredProjectChatTabsState,
  allowLanding: boolean,
): StoredProjectChatTabsState {
  if (allowLanding) return state;

  return {
    ...state,
    tabs: state.tabs.map((tab) => (
      tab.isLanding ? { ...tab, isLanding: false } : tab
    )),
  };
}

function isStoredProjectChatTab(value: unknown): value is ProjectChatTab {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProjectChatTab>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (typeof candidate.chatId === 'string' || candidate.chatId === null) &&
    typeof candidate.isLanding === 'boolean' &&
    typeof candidate.isFallback === 'boolean'
  );
}

function readStoredProjectChatTabsState(storageKey: string): StoredProjectChatTabsState | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProjectChatTabsState>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs.filter(isStoredProjectChatTab);
    if (tabs.length === 0) return null;
    return {
      tabs,
      activeTabId:
        typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
          ? parsed.activeTabId
          : tabs[0].id,
      assumptionsByTabId:
        parsed.assumptionsByTabId && typeof parsed.assumptionsByTabId === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.assumptionsByTabId)
                .filter(([tabId]) => tabs.some((tab) => tab.id === tabId))
                .map(([tabId, value]) => {
                  const source = (value ?? {}) as { focusAssumptionId?: unknown; collapsed?: unknown };
                  return [
                    tabId,
                    {
                      focusAssumptionId:
                        typeof source.focusAssumptionId === 'string' || source.focusAssumptionId === null
                          ? source.focusAssumptionId
                          : null,
                      collapsed: typeof source.collapsed === 'boolean' ? source.collapsed : false,
                    },
                  ];
                }),
            )
          : {},
    };
  } catch {
    return null;
  }
}

function writeStoredProjectChatTabsState(
  storageKey: string,
  state: StoredProjectChatTabsState,
) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function formatDeepDiveProjectContext(state: PlanWorkspaceInspectorState): string {
  const lines: string[] = [
    `The user is asking from a chat tab anchored to this deep-dive item. Default to this item as the current topic unless the user clearly switches topics.`,
    '',
    '## Selected Item',
    `- Title: ${state.item.title}`,
    `- Group: ${state.groupName}`,
    `- Kind: ${state.item.kind}`,
    `- Classification: ${state.item.classification}`,
    `- Status: ${state.item.status}`,
  ];

  if (state.item.phaseId) {
    lines.push(`- Phase: ${state.item.phaseId}`);
  }
  if (state.item.rationale) {
    lines.push(`- Rationale: ${state.item.rationale}`);
  }
  if (state.item.supports?.length) {
    lines.push(`- Supports: ${state.item.supports.join(', ')}`);
  }
  if (state.item.dependsOn?.length) {
    lines.push(`- Depends on: ${state.item.dependsOn.join(', ')}`);
  }

  if (state.loading) {
    lines.push('', '## Deep Dive Status', '- Research is still loading.');
    return lines.join('\n');
  }

  if (state.error) {
    lines.push('', '## Deep Dive Status', `- Research error: ${state.error}`);
    return lines.join('\n');
  }

  if (!state.result) {
    lines.push('', '## Deep Dive Status', '- No generated deep-dive result is available yet.');
    return lines.join('\n');
  }

  if (state.result.summary.length) {
    lines.push('', `## ${state.result.summaryTitle ?? 'Summary'}`);
    state.result.summary.forEach((entry) => lines.push(`- ${entry}`));
  }

  if (state.result.detailFields?.length) {
    lines.push('', `## ${state.result.detailFieldsTitle ?? 'Details'}`);
    state.result.detailFields.forEach((field) => lines.push(`- ${field.label}: ${field.value}`));
  }

  if (state.result.requirements.length) {
    lines.push('', `## ${state.result.requirementsTitle ?? 'Requirements'}`);
    state.result.requirements.forEach((requirement) => {
      lines.push(`- ${requirement.title}: ${requirement.description}`);
    });
  }

  if (state.result.dependencies.length) {
    lines.push('', `## ${state.result.dependenciesTitle ?? 'Dependencies'}`);
    state.result.dependencies.forEach((dependency) => {
      lines.push(`- ${dependency.condition}: ${dependency.effect}`);
    });
  }

  if (state.result.documentSources.length || state.result.linkSources.length) {
    lines.push('', '## Sources');
    state.result.documentSources.forEach((source) => lines.push(`- Document: ${source.title}`));
    state.result.linkSources.forEach((source) => {
      lines.push(`- Link: ${source.title}${source.publisher ? ` (${source.publisher})` : ''}`);
    });
  }

  return lines.join('\n');
}

export function ProjectChatTabsPanel({
  initiativeId,
  researchMode = false,
  sessionStorageKey,
  resetToLandingSignal = 0,
  pendingChatToOpen = null,
  pendingAutoSend = null,
  activeModuleContext = null,
  onPendingSessionHandled,
  onPendingAutoSendHandled,
  onEditorWidgetsChange,
  onOpenDocument,
  onOpenWorkspaceModule,
  onSendRef,
  topContent,
  pendingDeepDive = null,
  onPendingDeepDiveHandled,
  pendingAssumptions = null,
  onPendingAssumptionsHandled,
}: ProjectChatTabsPanelProps) {
  const initialStateRef = useRef<StoredProjectChatTabsState | null>(null);
  if (!initialStateRef.current) {
    const storedState = sessionStorageKey
      ? readStoredProjectChatTabsState(sessionStorageKey)
      : null;
    if (storedState) {
      initialStateRef.current = normalizeProjectChatTabsState(storedState, researchMode);
    } else {
      const initialTab = makeTab('New Chat', researchMode, true);
      initialStateRef.current = {
        tabs: [initialTab],
        activeTabId: initialTab.id,
      };
    }
  }
  const [tabs, setTabs] = useState<ProjectChatTab[]>(() => initialStateRef.current!.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => initialStateRef.current!.activeTabId ?? initialStateRef.current!.tabs[0].id);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [deepDiveByTabId, setDeepDiveByTabId] = useState<Record<string, PendingDeepDiveContext>>({});
  const [assumptionsByTabId, setAssumptionsByTabId] = useState<Record<string, PendingAssumptionsContext>>(
    () => {
      const stored = initialStateRef.current?.assumptionsByTabId ?? {};
      return Object.fromEntries(
        Object.entries(stored).map(([tabId, value]) => [
          tabId,
          {
            requestId: `stored-assumption-${tabId}`,
            focusAssumptionId: value.focusAssumptionId ?? null,
            collapsed: value.collapsed ?? false,
          },
        ]),
      );
    },
  );
  const [showHistory, setShowHistory] = useState(false);
  const [pendingAutoSendByTabId, setPendingAutoSendByTabId] = useState<Record<string, PendingAutoSendRequest>>({});
  const historyRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const deepDiveByTabIdRef = useRef<Record<string, PendingDeepDiveContext>>({});
  const assumptionsByTabIdRef = useRef<Record<string, PendingAssumptionsContext>>({});
  const tabsRef = useRef<ProjectChatTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  const handledDeepDiveRequestIdsRef = useRef<Set<string>>(new Set());
  const handledAssumptionsRequestIdsRef = useRef<Set<string>>(new Set());
  const handledAutoSendRequestIdsRef = useRef<Set<string>>(new Set());

  const resolvedActiveTabId = useMemo(
    () => (tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id ?? null),
    [tabs, activeTabId],
  );
  const showTabBar = !researchMode || tabs.some((tab) => !tab.isLanding);

  useEffect(() => {
    if (!resolvedActiveTabId || resolvedActiveTabId === activeTabId) return;
    setActiveTabId(resolvedActiveTabId);
  }, [resolvedActiveTabId, activeTabId]);

  useEffect(() => {
    if (!sessionStorageKey || !resolvedActiveTabId) return;
    writeStoredProjectChatTabsState(sessionStorageKey, {
      tabs,
      activeTabId: resolvedActiveTabId,
      assumptionsByTabId: Object.fromEntries(
        Object.entries(assumptionsByTabId).map(([tabId, value]) => [
          tabId,
          {
            focusAssumptionId: value.focusAssumptionId ?? null,
            collapsed: value.collapsed ?? false,
          },
        ]),
      ),
    });
  }, [sessionStorageKey, tabs, resolvedActiveTabId, assumptionsByTabId]);

  useEffect(() => {
    deepDiveByTabIdRef.current = deepDiveByTabId;
  }, [deepDiveByTabId]);

  useEffect(() => {
    assumptionsByTabIdRef.current = assumptionsByTabId;
  }, [assumptionsByTabId]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = resolvedActiveTabId;
  }, [resolvedActiveTabId]);

  useEffect(() => {
    if (!pendingDeepDive) return;
    if (handledDeepDiveRequestIdsRef.current.has(pendingDeepDive.requestId)) return;

    const existingTabEntry = Object.entries(deepDiveByTabIdRef.current).find(
      ([, value]) => value.requestId === pendingDeepDive.requestId,
    );

    if (existingTabEntry) {
      const [tabId] = existingTabEntry;
      setDeepDiveByTabId((prev) => ({
        ...prev,
        [tabId]: {
          ...pendingDeepDive,
          collapsed: pendingDeepDive.collapsed ?? prev[tabId]?.collapsed ?? false,
        },
      }));
      setActiveTabId(tabId);
      handledDeepDiveRequestIdsRef.current.add(pendingDeepDive.requestId);
      onPendingDeepDiveHandled?.();
      return;
    }

    const reusablePlaceholderTab =
      tabs.find((tab) =>
        tab.id === resolvedActiveTabId &&
        !tab.chatId &&
        (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      ) ??
      tabs.find((tab) =>
        !tab.chatId &&
        (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      );

    if (reusablePlaceholderTab) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === reusablePlaceholderTab.id
            ? {
                ...tab,
                title: pendingDeepDive.state.item.title,
                isLanding: false,
                isFallback: false,
              }
            : tab,
        ),
      );
      setActiveTabId(reusablePlaceholderTab.id);
      setDeepDiveByTabId((prev) => ({
        ...prev,
        [reusablePlaceholderTab.id]: {
          ...pendingDeepDive,
          collapsed: pendingDeepDive.collapsed ?? prev[reusablePlaceholderTab.id]?.collapsed ?? false,
        },
      }));
      handledDeepDiveRequestIdsRef.current.add(pendingDeepDive.requestId);
      onPendingDeepDiveHandled?.();
      return;
    }

    const tab = makeTab(pendingDeepDive.state.item.title, false, false);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setDeepDiveByTabId((prev) => ({
      ...prev,
      [tab.id]: {
        ...pendingDeepDive,
        collapsed: pendingDeepDive.collapsed ?? false,
      },
    }));
    handledDeepDiveRequestIdsRef.current.add(pendingDeepDive.requestId);
    onPendingDeepDiveHandled?.();
  }, [onPendingDeepDiveHandled, pendingDeepDive, resolvedActiveTabId, tabs]);

  useEffect(() => {
    if (!pendingAssumptions) return;
    if (handledAssumptionsRequestIdsRef.current.has(pendingAssumptions.requestId)) return;
    const nextAssumptionTitle = pendingAssumptions.title?.trim() || 'Assumptions';

    const existingAssumptionsTabId =
      Object.keys(assumptionsByTabIdRef.current).find((tabId) => tabId === resolvedActiveTabId) ??
      Object.keys(assumptionsByTabIdRef.current)[0];

    if (existingAssumptionsTabId) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === existingAssumptionsTabId
            ? { ...tab, title: nextAssumptionTitle, isLanding: false, isFallback: false }
            : tab,
        ),
      );
      setAssumptionsByTabId((prev) => ({
        ...prev,
        [existingAssumptionsTabId]: {
          ...pendingAssumptions,
          collapsed: pendingAssumptions.collapsed ?? prev[existingAssumptionsTabId]?.collapsed ?? false,
        },
      }));
      setActiveTabId(existingAssumptionsTabId);
      handledAssumptionsRequestIdsRef.current.add(pendingAssumptions.requestId);
      onPendingAssumptionsHandled?.();
      return;
    }

    const existingTabEntry = Object.entries(assumptionsByTabIdRef.current).find(
      ([, value]) => value.requestId === pendingAssumptions.requestId,
    );

    if (existingTabEntry) {
      const [tabId] = existingTabEntry;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? { ...tab, title: nextAssumptionTitle, isLanding: false, isFallback: false }
            : tab,
        ),
      );
      setAssumptionsByTabId((prev) => ({
        ...prev,
        [tabId]: {
          ...pendingAssumptions,
          collapsed: pendingAssumptions.collapsed ?? prev[tabId]?.collapsed ?? false,
        },
      }));
      setActiveTabId(tabId);
      handledAssumptionsRequestIdsRef.current.add(pendingAssumptions.requestId);
      onPendingAssumptionsHandled?.();
      return;
    }

    const reusablePlaceholderTab =
      tabs.find((tab) =>
        tab.id === resolvedActiveTabId &&
        !tab.chatId &&
        (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      ) ??
      tabs.find((tab) =>
        !tab.chatId &&
        (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      );

    if (reusablePlaceholderTab) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === reusablePlaceholderTab.id
            ? {
                ...tab,
                title: nextAssumptionTitle,
                isLanding: false,
                isFallback: false,
              }
            : tab,
        ),
      );
      setActiveTabId(reusablePlaceholderTab.id);
      setAssumptionsByTabId((prev) => ({
        ...prev,
        [reusablePlaceholderTab.id]: {
          ...pendingAssumptions,
          collapsed: pendingAssumptions.collapsed ?? prev[reusablePlaceholderTab.id]?.collapsed ?? false,
        },
      }));
      handledAssumptionsRequestIdsRef.current.add(pendingAssumptions.requestId);
      onPendingAssumptionsHandled?.();
      return;
    }

    const tab = makeTab(nextAssumptionTitle, false, false);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setAssumptionsByTabId((prev) => ({
      ...prev,
      [tab.id]: {
        ...pendingAssumptions,
        collapsed: pendingAssumptions.collapsed ?? false,
      },
    }));
    handledAssumptionsRequestIdsRef.current.add(pendingAssumptions.requestId);
    onPendingAssumptionsHandled?.();
  }, [onPendingAssumptionsHandled, pendingAssumptions, resolvedActiveTabId, tabs]);

  const handleDeepDiveCollapsedChange = useCallback((tabId: string, collapsed: boolean) => {
    setDeepDiveByTabId((prev) => {
      const current = prev[tabId];
      if (!current || current.collapsed === collapsed) return prev;
      return {
        ...prev,
        [tabId]: {
          ...current,
          collapsed,
        },
      };
    });
  }, []);

  const handleDeepDiveMessageSent = useCallback((tabId: string) => {
    handleDeepDiveCollapsedChange(tabId, true);
  }, [handleDeepDiveCollapsedChange]);

  const handleAssumptionsCollapsedChange = useCallback((tabId: string, collapsed: boolean) => {
    setAssumptionsByTabId((prev) => {
      const current = prev[tabId];
      if (!current || current.collapsed === collapsed) return prev;
      return {
        ...prev,
        [tabId]: {
          ...current,
          collapsed,
        },
      };
    });
  }, []);

  const handleAssumptionsClose = useCallback((tabId: string) => {
    setAssumptionsByTabId((prev) => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const handleAssumptionsMessageSent = useCallback((tabId: string) => {
    handleAssumptionsCollapsedChange(tabId, true);
  }, [handleAssumptionsCollapsedChange]);

  const loadSessions = useCallback(async () => {
    try {
      const { chats: raw } = await api.getChats(initiativeId);
      setSessions(
        raw.map((session) => ({
          id: session.id,
          title: session.title || 'Untitled',
          createdAt: session.created_at ? new Date(session.created_at).getTime() : Date.now(),
          messages: [],
        })),
      );
    } catch (err) {
      console.warn('Failed to load chat sessions:', err);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const findExistingNewChatTab = useCallback(
    () =>
      tabs.find(
        (tab) =>
          !tab.chatId &&
          (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      ),
    [tabs],
  );

  const handleCreateTab = useCallback(() => {
    const existing = findExistingNewChatTab();
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const tab = makeTab('New Chat', false, false);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [findExistingNewChatTab]);

  const handleCloseTab = useCallback((tabId: string) => {
    if (tabs.length === 1) {
      const replacement = makeTab('New Chat', researchMode, true);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      return;
    }

    const idx = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    setDeepDiveByTabId((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setAssumptionsByTabId((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });

    if (tabId === activeTabId) {
      const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
      if (fallback) {
        setActiveTabId(fallback.id);
      }
    }
  }, [tabs, activeTabId, researchMode]);

  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  useEffect(() => {
    if (!resolvedActiveTabId) return;
    const tabStrip = tabStripRef.current;
    const activeTabButton = tabButtonRefs.current[resolvedActiveTabId];
    if (!tabStrip || !activeTabButton) return;

    const stripRect = tabStrip.getBoundingClientRect();
    const tabRect = activeTabButton.getBoundingClientRect();
    const isOutOfView = tabRect.left < stripRect.left || tabRect.right > stripRect.right;
    if (!isOutOfView) return;

    activeTabButton.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [resolvedActiveTabId, tabs]);

  useEffect(() => {
    if (!pendingChatToOpen?.chatId) return;

    const existingTab = tabs.find((tab) => tab.chatId === pendingChatToOpen.chatId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      onPendingSessionHandled?.();
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === resolvedActiveTabId);
    if (activeTab && activeTab.isFallback && !activeTab.chatId) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                title: pendingChatToOpen.title?.trim() || 'Untitled',
                chatId: pendingChatToOpen.chatId,
                isLanding: false,
                isFallback: false,
              }
            : tab,
        ),
      );
      setActiveTabId(activeTab.id);
    } else {
      const newTab: ProjectChatTab = {
        id: makeTab().id,
        title: pendingChatToOpen.title?.trim() || 'Untitled',
        chatId: pendingChatToOpen.chatId,
        isLanding: false,
        isFallback: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
    onPendingSessionHandled?.();
  }, [pendingChatToOpen, tabs, resolvedActiveTabId, onPendingSessionHandled]);

  useEffect(() => {
    if (!pendingAutoSend?.requestId) return;
    if (handledAutoSendRequestIdsRef.current.has(pendingAutoSend.requestId)) return;
    handledAutoSendRequestIdsRef.current.add(pendingAutoSend.requestId);

    const currentTabs = tabsRef.current;
    const activeTab = currentTabs.find((tab) => tab.id === activeTabIdRef.current);
    const reusablePlaceholderTab =
      (activeTab &&
      !activeTab.chatId &&
      (activeTab.isFallback || activeTab.title.trim().toLowerCase() === 'new chat')
        ? activeTab
        : null) ??
      currentTabs.find(
        (tab) =>
          !tab.chatId &&
          (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      );

    if (reusablePlaceholderTab) {
      setPendingAutoSendByTabId((prev) => ({
        ...prev,
        [reusablePlaceholderTab.id]: pendingAutoSend,
      }));
      setActiveTabId(reusablePlaceholderTab.id);
      return;
    }

    const newTab = makeTab('New Chat', false, false);
    setPendingAutoSendByTabId((prev) => ({
      ...prev,
      [newTab.id]: pendingAutoSend,
    }));
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [pendingAutoSend]);

  const handleTabAutoSendHandled = useCallback(
    (tabId: string, requestId: string) => {
      setPendingAutoSendByTabId((prev) => {
        if (prev[tabId]?.requestId !== requestId) return prev;
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      onPendingAutoSendHandled?.();
    },
    [onPendingAutoSendHandled],
  );

  useEffect(() => {
    if (!researchMode || resetToLandingSignal === 0) return;
    const resetTab = makeTab('New Chat', true, true);
    setTabs([resetTab]);
    setActiveTabId(resetTab.id);
    setDeepDiveByTabId({});
    setAssumptionsByTabId({});
    setShowHistory(false);
  }, [researchMode, resetToLandingSignal]);

  const handleOpenSession = useCallback((session: ChatSession) => {
    const existingTab = tabs.find((tab) => tab.chatId === session.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setShowHistory(false);
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === resolvedActiveTabId);
    if (activeTab && activeTab.isFallback && !activeTab.chatId) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                title: session.title,
                chatId: session.id,
                isLanding: false,
                isFallback: false,
              }
            : tab,
        ),
      );
      setActiveTabId(activeTab.id);
    } else {
      const newTab: ProjectChatTab = {
        id: makeTab().id,
        title: session.title,
        chatId: session.id,
        isLanding: false,
        isFallback: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
    setShowHistory(false);
  }, [tabs, resolvedActiveTabId]);

  const handleDeleteSession = useCallback((chatId: string) => {
    const currentTabs = tabsRef.current;
    setSessions((prev) => prev.filter((session) => session.id !== chatId));

    const removedTabIds = new Set(
      currentTabs.filter((tab) => tab.chatId === chatId).map((tab) => tab.id),
    );
    const nextTabs = currentTabs.filter((tab) => !removedTabIds.has(tab.id));

    setDeepDiveByTabId((prev) => {
      if (removedTabIds.size === 0) return prev;

      const next = { ...prev };
      removedTabIds.forEach((tabId) => {
        delete next[tabId];
      });
      return next;
    });
    setAssumptionsByTabId((prev) => {
      if (removedTabIds.size === 0) return prev;

      const next = { ...prev };
      removedTabIds.forEach((tabId) => {
        delete next[tabId];
      });
      return next;
    });
    if (nextTabs.length === 0) {
      const replacement = makeTab('New Chat', researchMode, true);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
    } else if (removedTabIds.size > 0) {
      setTabs(nextTabs);
      setActiveTabId((current) =>
        nextTabs.some((tab) => tab.id === current) ? current : nextTabs[0].id,
      );
    }
    api.deleteChat(chatId).catch((err) => {
      console.error('Failed to delete session:', err);
      loadSessions();
    });
  }, [loadSessions, researchMode]);

  const handleTabMetaChange = useCallback((tabId: string, meta: { chatId: string | null; title: string | null }) => {
    const chatId = meta.chatId;
    if (chatId) {
      const title = meta.title?.trim() || 'Untitled';
      setSessions((prev) => {
        const existing = prev.find((session) => session.id === chatId);
        if (existing) {
          return prev.map((session) =>
            session.id === chatId ? { ...session, title } : session,
          );
        }
        return [{ id: chatId, title, createdAt: Date.now(), messages: [] }, ...prev].slice(0, 50);
      });
    }

    setTabs((prev) => {
      let changed = false;
      const nextTabs = prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        const nextChatId = meta.chatId ?? tab.chatId;
        const nextTitle = meta.title?.trim() || tab.title;
        if (tab.chatId === nextChatId && tab.title === nextTitle) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          chatId: nextChatId,
          title: nextTitle,
          isLanding: false,
          isFallback: false,
        };
      });
      return changed ? nextTabs : prev;
    });
  }, []);

  const handleLandingStateChange = useCallback((tabId: string, isLanding: boolean) => {
    setTabs((prev) => {
      let changed = false;
      const nextTabs = prev.map((tab) => {
        if (tab.id !== tabId || tab.isLanding === isLanding) return tab;
        changed = true;
        return { ...tab, isLanding };
      });
      return changed ? nextTabs : prev;
    });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {showTabBar && (
        <div className="flex-shrink-0 flex items-stretch border-b border-divider bg-surface-subtle/50 h-[36px]">
          <div
            ref={tabStripRef}
            className="flex-1 flex items-stretch overflow-x-auto min-w-0"
            style={{ scrollbarWidth: 'none' }}
          >
            {tabs.map((tab) => {
              const isActive = tab.id === resolvedActiveTabId;
              const style = { flexShrink: 0, width: 148 };

              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    tabButtonRefs.current[tab.id] = node;
                  }}
                  onClick={() => setActiveTabId(tab.id)}
                  style={style}
                  className={[
                    'group relative flex items-center gap-1 px-2.5 text-xs whitespace-nowrap transition-colors border-r border-divider last:border-r-0',
                    isActive
                      ? 'bg-white text-text-primary font-medium shadow-subtle z-10'
                      : 'text-text-tertiary hover:text-text-secondary hover:bg-white/60',
                  ].join(' ')}
                >
                  <span className="flex-shrink-0 text-text-tertiary">
                    <MessageSquare className="w-3.5 h-3.5" />
                  </span>
                  <Tooltip content={tab.title} className="flex-1 min-w-0" fitContent showDelayMs={1000}>
                    <span className="block truncate text-left">{tab.title}</span>
                  </Tooltip>
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/10 flex-shrink-0 flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-shrink-0 flex items-center gap-0.5 px-1.5 border-l border-divider">
            <div className="relative" ref={historyRef}>
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                className={`
                  flex items-center justify-center w-7 h-7 rounded transition-colors
                  ${showHistory
                    ? 'text-accent bg-accent-wash'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle'}
                `}
                title="Chat history"
              >
                <Clock className="w-3.5 h-3.5" />
              </button>
              {showHistory && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-divider rounded-lg shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-divider">
                    <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      Chat History
                    </h3>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {sessions.length === 0 ? (
                      <div className="px-3 py-6 text-xs text-text-tertiary text-center">
                        No chat history
                      </div>
                    ) : (
                      sessions.map((session) => (
                        <div
                          key={session.id}
                          className="group flex items-center gap-2 px-3 py-2.5 hover:bg-surface-subtle cursor-pointer border-b border-divider last:border-b-0 transition-colors"
                          onClick={() => handleOpenSession(session)}
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-text-primary truncate">{session.title}</p>
                            <p className="text-[10px] text-text-tertiary mt-0.5">
                              {relativeTime(session.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-text-tertiary hover:text-red-500 flex-shrink-0"
                            title="Delete conversation"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleCreateTab}
              className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
              title="New chat"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {tabs.map((tab) => {
          const isActive = tab.id === resolvedActiveTabId;
          const deepDive = deepDiveByTabId[tab.id];
          const assumptions = assumptionsByTabId[tab.id];
          const showExpandedDeepDive = Boolean(deepDive && !deepDive.collapsed);
          const showExpandedAssumptions = Boolean(assumptions && !assumptions.collapsed);
          const tabPendingAutoSend = pendingAutoSendByTabId[tab.id] ?? null;
          const tabTopContent = deepDive ? (
            <DeepDiveWidget
              state={deepDive.state}
              collapsed={deepDive.collapsed}
              layoutMode={showExpandedDeepDive ? 'panel' : 'inline'}
              onCollapsedChange={(collapsed) => handleDeepDiveCollapsedChange(tab.id, collapsed)}
              onOpenDocument={deepDive.onOpenDocument}
            />
          ) : assumptions ? (
            <AssumptionsChatPanel
              initiativeId={initiativeId}
              focusAssumptionId={assumptions.focusAssumptionId ?? null}
              collapsed={assumptions.collapsed ?? false}
              layoutMode={showExpandedAssumptions ? 'panel' : 'inline'}
              onCollapsedChange={(collapsed) => handleAssumptionsCollapsedChange(tab.id, collapsed)}
              onClose={() => handleAssumptionsClose(tab.id)}
            />
          ) : isActive ? topContent : undefined;
          return (
            <div
              key={tab.id}
              className={isActive ? 'absolute inset-0' : 'absolute inset-0 hidden'}
            >
              <ProjectChatSurface
                initiativeId={initiativeId}
                hideTiles={researchMode}
                useLandingWhenEmpty={researchMode && tab.isLanding}
                initialChatId={tab.chatId}
                initialTitle={tab.title}
                sessions={sessions}
                activeModuleContext={activeModuleContext}
                onDeleteChat={handleDeleteSession}
                onChatListDirty={loadSessions}
                onChatMetaChange={(meta) => handleTabMetaChange(tab.id, meta)}
                onLandingStateChange={(isLanding) => handleLandingStateChange(tab.id, isLanding)}
                onEditorWidgetsChange={isActive ? onEditorWidgetsChange : undefined}
                onOpenDocument={isActive ? onOpenDocument : undefined}
                onOpenWorkspaceModule={isActive ? onOpenWorkspaceModule : undefined}
                onSendRef={isActive ? onSendRef : undefined}
                pendingAutoSend={tabPendingAutoSend}
                onPendingAutoSendHandled={
                  tabPendingAutoSend
                    ? () => handleTabAutoSendHandled(tab.id, tabPendingAutoSend.requestId)
                    : undefined
                }
                onBeforeSendMessage={
                  isActive && deepDive
                    ? () => handleDeepDiveMessageSent(tab.id)
                    : isActive && assumptions
                      ? () => handleAssumptionsMessageSent(tab.id)
                      : undefined
                }
                projectContext={deepDive ? formatDeepDiveProjectContext(deepDive.state) : null}
                topContentMode={showExpandedDeepDive || showExpandedAssumptions ? 'panel' : 'inline'}
                topContent={tabTopContent}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

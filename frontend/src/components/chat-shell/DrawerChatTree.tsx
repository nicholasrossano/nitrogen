'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export interface ChatListItem {
  id: string;
  title: string | null;
  updated_at: string | null;
  initiative_id: string | null;
  project_id?: string | null;
}

interface DrawerChatTreeProps {
  activeChatId: string | null;
  onSelectChat: (chatId: string, projectId?: string | null) => void;
  onNewChat: (projectId?: string | null) => void;
  refreshKey?: number;
}

const PAGE_SIZE = 5;
const TREE_LEADING_SLOT = 'flex h-5 w-5 shrink-0 items-center justify-center';

export function DrawerChatTree({
  activeChatId,
  onSelectChat,
  onNewChat,
  refreshKey = 0,
}: DrawerChatTreeProps) {
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces]);

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const [projectRows, chatResponse] = await Promise.all([
        api.listProjects(100, 0, false, activeWorkspace.id),
        api.getChats(),
      ]);
      setProjects(projectRows);
      setChats(chatResponse.chats);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const p of projectRows) next[p.id] = prev[p.id] ?? true;
        return next;
      });
      setVisibleCount((prev) => {
        const next = { ...prev };
        for (const p of projectRows) {
          if (next[p.id] == null) next[p.id] = PAGE_SIZE;
        }
        return next;
      });
      hasLoadedOnceRef.current = true;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const chatsByKey = useMemo(() => {
    const buckets = new Map<string, ChatListItem[]>();
    for (const p of projects) buckets.set(p.id, []);
    for (const chat of chats) {
      const key = chat.project_id || chat.initiative_id;
      if (!key || !buckets.has(key)) continue;
      buckets.get(key)!.push(chat);
    }
    for (const [, list] of buckets) {
      list.sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''));
    }
    return buckets;
  }, [chats, projects]);

  const sections = useMemo(
    () =>
      projects.map((p) => ({
        key: p.id,
        name: p.name,
      })),
    [projects],
  );

  const renderChatRow = (chat: ChatListItem, projectId: string | null) => {
    const label = chat.title?.trim() || 'Untitled chat';
    const active = chat.id === activeChatId;
    return (
      <button
        key={chat.id}
        type="button"
        onClick={() => onSelectChat(chat.id, projectId)}
        className={`w-full flex items-center gap-2 px-0.5 py-1.5 rounded-md text-xs text-left transition-colors ${
          active ? 'bg-surface-subtle text-text-primary' : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary'
        }`}
        title={label}
      >
        <span className={TREE_LEADING_SLOT}>
          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-accent' : 'bg-text-tertiary/50'}`} />
        </span>
        <span className="truncate flex-1 min-w-0">{label}</span>
      </button>
    );
  };

  const renderSection = ({
    key,
    name,
  }: {
    key: string;
    name: string;
  }) => {
    const list = chatsByKey.get(key) ?? [];
    const open = expanded[key] ?? true;
    const limit = visibleCount[key] ?? PAGE_SIZE;
    const visible = list.slice(0, limit);
    const remaining = list.length - visible.length;

    return (
      <div key={key} className="flex flex-col gap-0.5">
        <div className="w-full flex items-center gap-0.5 px-0.5 py-0.5 rounded-lg hover:bg-black/[0.03] transition-colors group">
          <button
            type="button"
            onClick={() => setExpanded((e) => ({ ...e, [key]: !open }))}
            className={`${TREE_LEADING_SLOT} rounded-md text-text-tertiary hover:text-text-primary hover:bg-black/[0.06] transition-colors`}
            aria-label={open ? `Collapse ${name} chats` : `Expand ${name} chats`}
            title={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={() => onNewChat(key)}
            className="flex flex-1 min-w-0 items-center px-1 py-1 rounded-md text-left"
            title={`Open ${name}`}
          >
            <span className="truncate flex-1 text-xs font-semibold text-text-primary">{name}</span>
          </button>
          <button
            type="button"
            onClick={() => onNewChat(key)}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/[0.06] text-text-tertiary hover:text-text-primary transition-all shrink-0"
            title={`New chat in ${name}`}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {open && (
          <div className="flex flex-col gap-0.5">
            {visible.length === 0 ? (
              <p className="flex items-center gap-2 px-0.5 py-1 text-[10px] text-text-tertiary">
                <span className={TREE_LEADING_SLOT} aria-hidden="true" />
                No chats yet
              </p>
            ) : (
              visible.map((chat) => renderChatRow(chat, key))
            )}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((c) => ({
                    ...c,
                    [key]: (c[key] ?? PAGE_SIZE) + PAGE_SIZE,
                  }))
                }
                className="flex items-center gap-2 px-0.5 py-1 text-[10px] text-text-tertiary hover:text-text-primary text-left"
              >
                <span className={TREE_LEADING_SLOT} aria-hidden="true" />
                See more ({remaining})
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0 h-full px-1.5 pb-3">
      {loading ? (
        <p className="px-2 pt-2 text-[11px] text-text-tertiary">Loading…</p>
      ) : loadError ? (
        <p className="px-2 pt-2 text-[11px] text-red-500">{loadError}</p>
      ) : projects.length === 0 ? (
        <div className="px-2 pt-2">
          <p className="text-[11px] text-text-tertiary">
            No projects in {activeWorkspace?.name ?? 'this workspace'}.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1 pt-1">
          {sections.map(renderSection)}
        </div>
      )}
    </div>
  );
}

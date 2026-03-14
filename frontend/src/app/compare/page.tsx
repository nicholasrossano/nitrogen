'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Scale, Search, ChevronDown, X, Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { api, Initiative, SourceCitation } from '@/lib/api';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CompareStandaloneChatView } from '@/components/core-chat/CompareStandaloneChatView';
import { ResearchPanel } from '@/components/core-chat/ResearchPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { EditorSidePanel } from '@/components/editor';
import type { EditorWidget } from '@/components/editor';
import { SideDrawer, NavItem } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const MIN_CHAT_PERCENT = 30;
const MAX_CHAT_PERCENT = 60;
const DEFAULT_CHAT_PERCENT = 55;
const MIN_RESEARCH_PERCENT = 20;
const MAX_RESEARCH_PERCENT = 25;
const DEFAULT_RESEARCH_PERCENT = 25;

function ComparePageContent() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [projects, setProjects] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedA, setSelectedA] = useState<Initiative | null>(null);
  const [selectedB, setSelectedB] = useState<Initiative | null>(null);
  const [started, setStarted] = useState(false);
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);

  // Compare session history
  interface CompareSession {
    id: string;
    title: string;
    createdAt: number;
    compare_initiative_ids: string[];
  }
  const [compareSessions, setCompareSessions] = useState<CompareSession[]>([]);

  // Three-panel layout state (mirrors initiatives/[id]/page.tsx)
  const containerRef = useRef<HTMLDivElement>(null);
  const [researchCitation, setResearchCitation] = useState<ResearchPanelCitation | null>(null);
  const [editorWidgets, setEditorWidgets] = useState<EditorWidget[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [chatWidthPercent, setChatWidthPercent] = useState(DEFAULT_CHAT_PERCENT);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [researchWidthPercent, setResearchWidthPercent] = useState(DEFAULT_RESEARCH_PERCENT);
  const [isResizingResearch, setIsResizingResearch] = useState(false);
  const [isCompareLanding, setIsCompareLanding] = useState(true);

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.push('/login');
  }, [signOut, router]);

  useEffect(() => {
    api.listInitiatives(50, 0, false)
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchCompareSessions = useCallback(() => {
    api.getCoreChatSessions()
      .then(({ sessions }) => {
        setCompareSessions(
          sessions
            .filter((s) => s.compare_initiative_ids && s.compare_initiative_ids.length === 2)
            .map((s) => ({
              id: s.id,
              title: s.title || 'Untitled comparison',
              createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
              compare_initiative_ids: s.compare_initiative_ids!,
            })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchCompareSessions(); }, [fetchCompareSessions]);

  const handleLoadHistorySession = useCallback((session: CompareSession) => {
    const projA = projects.find((p) => p.id === session.compare_initiative_ids[0]);
    const projB = projects.find((p) => p.id === session.compare_initiative_ids[1]);
    if (projA) setSelectedA(projA);
    if (projB) setSelectedB(projB);
    setInitialSessionId(session.id);
    setStarted(true);
  }, [projects]);

  const handleDeleteHistorySession = useCallback((id: string) => {
    setCompareSessions((prev) => prev.filter((s) => s.id !== id));
    api.deleteCoreChatSession(id).catch(() => {});
  }, []);

  const handleLandingChange = useCallback((isLanding: boolean) => {
    setIsCompareLanding(isLanding);
    if (isLanding) {
      setResearchCitation(null);
      setEditorWidgets([]);
      setShowEditor(false);
    }
  }, []);

  const handleCitationClick = useCallback((citation: SourceCitation) => {
    if (
      (citation.source_type === 'corpus' || citation.source_type === 'evidence') &&
      citation.evidence_doc_id
    ) {
      setResearchCitation({
        evidence_doc_id: citation.evidence_doc_id,
        chunk_id: citation.chunk_id ?? null,
        source_title: citation.source_title,
      });
    } else if (citation.source_url) {
      window.open(citation.source_url, '_blank', 'noopener');
    }
  }, []);

  const handleOpenFullDoc = useCallback((citation: ResearchPanelCitation) => {
    const viewerWidget: EditorWidget = {
      type: 'document_viewer',
      data: {
        evidence_doc_id: citation.evidence_doc_id,
        chunk_id: citation.chunk_id,
        source_title: citation.source_title,
      },
      messageId: 'citation-nav',
    };
    setEditorWidgets((prev) => {
      const filtered = prev.filter((w) => w.type !== 'document_viewer');
      return [...filtered, viewerWidget];
    });
    setShowEditor(true);
  }, []);

  // Resize handlers
  const handleChatMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingChat || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const maxPct = researchCitation
      ? 100 - researchWidthPercent - 40
      : MAX_CHAT_PERCENT;
    setChatWidthPercent(Math.min(maxPct, Math.max(MIN_CHAT_PERCENT, pct)));
  }, [isResizingChat, researchCitation, researchWidthPercent]);

  const handleChatMouseUp = useCallback(() => setIsResizingChat(false), []);

  const handleResearchMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingResearch || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((rect.right - e.clientX) / rect.width) * 100;
    setResearchWidthPercent(Math.min(MAX_RESEARCH_PERCENT, Math.max(MIN_RESEARCH_PERCENT, pct)));
  }, [isResizingResearch]);

  const handleResearchMouseUp = useCallback(() => setIsResizingResearch(false), []);

  useEffect(() => {
    if (isResizingChat) {
      document.addEventListener('mousemove', handleChatMouseMove);
      document.addEventListener('mouseup', handleChatMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleChatMouseMove);
      document.removeEventListener('mouseup', handleChatMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingChat, handleChatMouseMove, handleChatMouseUp]);

  useEffect(() => {
    if (isResizingResearch) {
      document.addEventListener('mousemove', handleResearchMouseMove);
      document.addEventListener('mouseup', handleResearchMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleResearchMouseMove);
      document.removeEventListener('mouseup', handleResearchMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingResearch, handleResearchMouseMove, handleResearchMouseUp]);

  const handleNavChange = useCallback((item: NavItem) => {
    if (item === 'home') router.push('/');
    if (item === 'compare') return; // already here
    if (item === 'trash') router.push('/');
  }, [router]);

  if (started && selectedA && selectedB) {
    const hasEditor = !isCompareLanding && showEditor && editorWidgets.length > 0;
    const hasResearch = !isCompareLanding && !!researchCitation;
    const chatWidth = hasEditor
      ? `${Math.min(hasResearch ? 100 - researchWidthPercent - 40 : MAX_CHAT_PERCENT, chatWidthPercent)}%`
      : hasResearch
        ? `${100 - researchWidthPercent}%`
        : '100%';

    return (
      <div className="min-h-screen h-screen flex flex-col bg-background">
        <header className="shrink-0 h-14" />
        <div className="flex flex-1 min-h-0">
          <SideDrawer
            variant="home"
            activeItem="compare"
            onItemSelect={handleNavChange}
            onSignOut={handleSignOut}
            userEmail={user?.email}
          />
          <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
            <main
              ref={containerRef}
              className="h-full bg-surface rounded-lg shadow-workspace overflow-hidden flex"
            >
              {/* Chat column */}
              <div
                className="flex-shrink-0 relative overflow-hidden"
                style={{ width: chatWidth }}
              >
                <div className="absolute inset-0 overflow-hidden">
                  <CompareStandaloneChatView
                    compareInitiativeIds={[selectedA.id, selectedB.id]}
                    titleA={selectedA.title || 'Untitled'}
                    titleB={selectedB.title || 'Untitled'}
                    onCitationClick={handleCitationClick}
                    onBack={() => { setStarted(false); setInitialSessionId(null); fetchCompareSessions(); }}
                    onLandingChange={handleLandingChange}
                    initialSessionId={initialSessionId}
                  />
                </div>
                {hasEditor && (
                  <div
                    onMouseDown={(e) => { e.preventDefault(); setIsResizingChat(true); }}
                    className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors ${isResizingChat ? 'bg-accent/50' : 'bg-transparent'}`}
                  />
                )}
              </div>

              {/* Research panel */}
              {hasResearch && (
                <div
                  className="flex-shrink-0 overflow-hidden relative"
                  style={{ width: `${researchWidthPercent}%` }}
                >
                  <div
                    onMouseDown={(e) => { e.preventDefault(); setIsResizingResearch(true); }}
                    className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10 ${isResizingResearch ? 'bg-accent/50' : 'bg-transparent'}`}
                  />
                  <ResearchPanel
                    key={`${researchCitation!.evidence_doc_id}-${researchCitation!.chunk_id}`}
                    citation={researchCitation!}
                    onClose={() => setResearchCitation(null)}
                    onOpenFullDoc={handleOpenFullDoc}
                  />
                </div>
              )}

              {/* Document viewer */}
              {hasEditor && (
                <div
                  className="flex-1 overflow-hidden border-l border-divider"
                  style={{ minWidth: '40%' }}
                >
                  <EditorSidePanel
                    widgets={editorWidgets}
                    initiativeId={selectedA.id}
                  />
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen h-screen flex flex-col bg-background">
      <header className="shrink-0 h-14" />
      <div className="flex flex-1 min-h-0">
        <SideDrawer
          variant="home"
          activeItem="compare"
          onItemSelect={handleNavChange}
          onSignOut={handleSignOut}
          userEmail={user?.email}
        />
        <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
          <main className="h-full bg-surface rounded-lg shadow-workspace overflow-auto">
            <div className="min-h-full flex flex-col items-center justify-center px-6 py-12">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-10">
                <div className="w-14 h-14 rounded-lg bg-accent-wash flex items-center justify-center mx-auto mb-4">
                  <Scale className="w-7 h-7 text-accent" />
                </div>
                <h1 className="text-xl font-semibold text-text-primary mb-2">
                  Compare Projects
                </h1>
                <p className="text-sm text-text-secondary">
                  Select two projects to compare side by side through grounded, conversational analysis.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-8">
                <ProjectSlot
                  label="Project A"
                  color="blue"
                  selected={selectedA}
                  onSelect={setSelectedA}
                  projects={projects}
                  excludeId={selectedB?.id}
                  loading={loading}
                />
                <ProjectSlot
                  label="Project B"
                  color="amber"
                  selected={selectedB}
                  onSelect={setSelectedB}
                  projects={projects}
                  excludeId={selectedA?.id}
                  loading={loading}
                />
              </div>

              <div className="flex justify-center">
                <button
                  onClick={() => { setInitialSessionId(null); setStarted(true); }}
                  disabled={!selectedA || !selectedB}
                  className="btn-primary !px-6"
                >
                  <Scale className="w-4 h-4" />
                  Start Comparison
                </button>
              </div>

              {compareSessions.length > 0 && (
                <div className="mt-12">
                  <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 px-1">
                    History
                  </p>
                  <div className="space-y-1">
                    {compareSessions.map((session) => (
                      <CompareHistoryRow
                        key={session.id}
                        session={session}
                        projects={projects}
                        onOpen={() => handleLoadHistorySession(session)}
                        onDelete={() => handleDeleteHistorySession(session.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
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

function CompareHistoryRow({
  session,
  projects,
  onOpen,
  onDelete,
}: {
  session: { id: string; title: string; createdAt: number; compare_initiative_ids: string[] };
  projects: Initiative[];
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const nameA = projects.find((p) => p.id === session.compare_initiative_ids[0])?.title;
  const nameB = projects.find((p) => p.id === session.compare_initiative_ids[1])?.title;
  const subtitle = nameA && nameB ? `${nameA} vs ${nameB}` : null;

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-subtle transition-colors duration-100 cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      <MessageSquare className="w-4 h-4 text-text-tertiary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="block text-sm text-text-secondary truncate">
          {session.title}
        </span>
        {subtitle && subtitle !== session.title && (
          <span className="block text-[11px] text-text-tertiary truncate">
            {subtitle}
          </span>
        )}
      </div>
      <span className="text-xs text-text-tertiary shrink-0 tabular-nums">
        {relativeTime(session.createdAt)}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`shrink-0 p-0.5 rounded transition-all duration-100 text-text-tertiary hover:text-red-400 ${
          hovered ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="Delete comparison"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ProjectSlot({
  label,
  color,
  selected,
  onSelect,
  projects,
  excludeId,
  loading,
}: {
  label: string;
  color: 'blue' | 'amber';
  selected: Initiative | null;
  onSelect: (p: Initiative | null) => void;
  projects: Initiative[];
  excludeId?: string;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = projects.filter((p) => {
    if (p.id === excludeId) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (p.title || '').toLowerCase().includes(q) ||
      (p.project_description || '').toLowerCase().includes(q)
    );
  });

  const borderColor = color === 'blue'
    ? 'border-stroke-accent/40'
    : 'border-accent-secondary-tint/50';
  const labelColor = color === 'blue'
    ? 'text-accent'
    : 'text-accent-secondary';
  const badgeColor = color === 'blue'
    ? 'bg-accent-wash text-accent'
    : 'bg-accent-secondary-wash text-accent-secondary';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
      </div>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border ${borderColor} bg-surface text-left text-sm transition-colors hover:bg-surface-subtle`}
        >
          {selected ? (
            <>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badgeColor}`}>
                {label.split(' ')[1]}
              </span>
              <span className="flex-1 truncate text-text-primary font-medium">
                {selected.title || 'Untitled Project'}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onSelect(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSelect(null); } }}
                className="shrink-0 p-0.5 rounded hover:bg-surface-subtle cursor-pointer"
              >
                <X className="w-3 h-3 text-text-tertiary" />
              </span>
            </>
          ) : (
            <>
              <span className="flex-1 text-text-tertiary">Select a project...</span>
              <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
            </>
          )}
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-stroke-subtle bg-surface shadow-lg max-h-64 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-stroke-subtle">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects..."
                  className="w-full h-8 pl-7 pr-3 text-xs rounded-md border border-stroke-subtle bg-surface-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-tertiary">
                  No matching projects
                </div>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { onSelect(p); setOpen(false); setSearch(''); }}
                    className="w-full flex flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-subtle transition-colors"
                  >
                    <span className="text-sm font-medium text-text-primary truncate">
                      {p.title || 'Untitled Project'}
                    </span>
                    {p.project_description && (
                      <span className="text-[11px] text-text-tertiary truncate">
                        {p.project_description.slice(0, 80)}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <ProtectedRoute>
      <ComparePageContent />
    </ProtectedRoute>
  );
}

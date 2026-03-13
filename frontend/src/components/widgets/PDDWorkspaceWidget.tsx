'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FileText,
  FileSearch,
  FolderOpen,
  Loader2,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  GripVertical,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  Circle,
  Pencil,
  Search,
  ArrowRight,
  RotateCcw,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type {
  PDDWorkspace,
  PDDOutlineSection,
  PDDSectionState,
  PDDConsistencyFinding,
  PDDEvidenceItem,
} from '@/lib/api';

interface PDDWorkspaceWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

type Stage = PDDWorkspace['status'];

export function PDDWorkspaceWidget({
  data,
  initiativeId,
  isActive = true,
}: PDDWorkspaceWidgetProps) {
  const [workspace, setWorkspace] = useState<PDDWorkspace | null>(
    (data as PDDWorkspace) ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) setWorkspace(ws);
    } catch {}
  }, [initiativeId]);

  useEffect(() => {
    if (!workspace && data) {
      setWorkspace(data as PDDWorkspace);
    }
  }, [data, workspace]);

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
      </div>
    );
  }

  const stage: Stage = workspace.status;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center justify-between text-xs text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {stage === 'scan' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <p className="text-xs text-text-tertiary">Preparing PDD outline...</p>
        </div>
      )}
      {stage === 'outline' && (
        <OutlineView
          workspace={workspace}
          initiativeId={initiativeId}
          isActive={isActive}
          loading={loading}
          onLoading={setLoading}
          onError={setError}
          onUpdate={setWorkspace}
        />
      )}
      {stage === 'authoring' && (
        <AuthoringView
          workspace={workspace}
          initiativeId={initiativeId}
          isActive={isActive}
          loading={loading}
          onLoading={setLoading}
          onError={setError}
          onUpdate={setWorkspace}
          onRefresh={refresh}
        />
      )}
      {stage === 'review' && (
        <ConsistencyView
          workspace={workspace}
          initiativeId={initiativeId}
          isActive={isActive}
          loading={loading}
          onLoading={setLoading}
          onError={setError}
          onUpdate={setWorkspace}
        />
      )}
      {stage === 'assembled' && (
        <AssemblyView
          workspace={workspace}
          initiativeId={initiativeId}
          isActive={isActive}
          loading={loading}
          onLoading={setLoading}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ========================================================================= */
/*  Shared sub-view props                                                    */
/* ========================================================================= */

interface SubViewProps {
  workspace: PDDWorkspace;
  initiativeId: string;
  isActive: boolean;
  loading: boolean;
  onLoading: (v: boolean) => void;
  onError: (msg: string | null) => void;
  onUpdate: (ws: PDDWorkspace) => void;
}

/* ========================================================================= */
/*  Outline sortable row                                                     */
/* ========================================================================= */

interface SortableRowProps {
  section: PDDOutlineSection;
  isEditing: boolean;
  editTitle: string;
  isActive: boolean;
  onStartEdit: (s: PDDOutlineSection) => void;
  onFinishEdit: (id: string) => void;
  onCancelEdit: () => void;
  onEditTitleChange: (v: string) => void;
  onRemove: (id: string) => void;
  isDragOverlay?: boolean;
}

function SortableRow({
  section,
  isEditing,
  editTitle,
  isActive,
  onStartEdit,
  onFinishEdit,
  onCancelEdit,
  onEditTitleChange,
  onRemove,
  isDragOverlay = false,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: !isActive || isEditing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={isDragOverlay ? undefined : style}
      className={[
        'px-5 py-3 flex items-center gap-3 group border-b border-divider bg-surface-primary transition-shadow',
        isDragging && !isDragOverlay ? 'opacity-0' : '',
        isDragOverlay ? 'shadow-lg rounded-lg border border-divider opacity-100' : '',
      ].join(' ')}
    >
      {isActive && (
        <button
          {...(isEditing ? {} : { ...attributes, ...listeners })}
          className="p-0.5 text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing shrink-0 touch-none"
          tabIndex={-1}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={() => onFinishEdit(section.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onFinishEdit(section.id);
              if (e.key === 'Escape') onCancelEdit();
            }}
            className="w-full text-sm font-medium text-text-primary bg-transparent border-b border-accent focus:outline-none"
          />
        ) : (
          <p className="text-sm font-medium text-text-primary truncate">{section.title}</p>
        )}
      </div>

      {isActive && !isEditing && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onStartEdit(section)}
            className="p-1 text-text-tertiary hover:text-text-secondary"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onRemove(section.id)}
            className="p-1 text-text-tertiary hover:text-red-500"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= */
/*  Outline View                                                             */
/* ========================================================================= */

function OutlineView({ workspace, initiativeId, isActive, loading, onLoading, onError, onUpdate }: SubViewProps) {
  const [sections, setSections] = useState<PDDOutlineSection[]>(workspace.outline || []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleStartEdit = (s: PDDOutlineSection) => {
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const handleFinishEdit = (id: string) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, title: editTitle } : s)));
    setEditingId(null);
  };

  const handleCancelEdit = () => setEditingId(null);

  const handleRemove = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAdd = () => {
    const newId = `custom_${Date.now()}`;
    setSections((prev) => [
      ...prev,
      { id: newId, title: 'New Section', description: '', key_topics: [] },
    ]);
    setEditingId(newId);
    setEditTitle('New Section');
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (over && active.id !== over.id) {
      setSections((prev) => {
        const oldIdx = prev.findIndex((s) => s.id === active.id);
        const newIdx = prev.findIndex((s) => s.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const handleConfirm = async () => {
    onLoading(true);
    onError(null);
    try {
      await api.updatePDDOutline(initiativeId, sections);
      await api.confirmPDDOutline(initiativeId);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
    } catch (e: any) {
      onError(e.message || 'Failed to confirm outline');
    } finally {
      onLoading(false);
    }
  };

  const activeSection = sections.find((s) => s.id === activeId);

  const rowProps = (section: PDDOutlineSection) => ({
    section,
    isEditing: editingId === section.id,
    editTitle,
    isActive,
    onStartEdit: handleStartEdit,
    onFinishEdit: handleFinishEdit,
    onCancelEdit: handleCancelEdit,
    onEditTitleChange: setEditTitle,
    onRemove: handleRemove,
  });

  return (
    <>
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">PDD Outline</h3>
        </div>
        <p className="text-xs text-text-secondary">
          Drag to reorder, click to rename, or add and remove sections.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map((section) => (
              <SortableRow key={section.id} {...rowProps(section)} />
            ))}
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {activeSection ? (
              <SortableRow {...rowProps(activeSection)} isDragOverlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {isActive && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-accent transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add section
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || sections.length === 0}
            className="btn-primary !text-xs !px-4 !py-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Confirm Outline
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/*  3. Authoring View                                                        */
/* ========================================================================= */

const SECTION_STATUS_CONFIG = {
  pending:   { label: 'Not started', bg: 'bg-surface-subtle',           text: 'text-text-tertiary' },
  prepared:  { label: 'Ready',       bg: 'bg-blue-50',                  text: 'text-blue-600'       },
  drafted:   { label: 'Drafted',     bg: 'bg-amber-50',                 text: 'text-amber-600'      },
  confirmed: { label: 'Approved',    bg: 'bg-green-50',                 text: 'text-green-700'      },
} as const;

function AuthoringView({
  workspace,
  initiativeId,
  isActive,
  onError,
  onUpdate,
}: SubViewProps & { onRefresh?: () => Promise<void> }) {
  const outline = workspace.outline || [];
  const sections = workspace.sections || {};
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [noEvidence, setNoEvidence] = useState(false);
  const [updateAnswers, setUpdateAnswers] = useState('');
  const [subLoading, setSubLoading] = useState<'prepare' | 'draft' | 'update' | 'confirm' | null>(null);
  const [loadingLabel, setLoadingLabel] = useState('');

  const confirmedCount = outline.filter((s) => sections[s.id]?.status === 'confirmed').length;

  const openSection = outline.find((s) => s.id === openSectionId);
  const sectionState: PDDSectionState | undefined = openSectionId ? sections[openSectionId] : undefined;
  const sectionStatus = sectionState?.status || 'pending';

  // Reset no-evidence flag when navigating to a different section
  const handleOpenSection = (id: string) => {
    setNoEvidence(false);
    setUpdateAnswers('');
    setOpenSectionId(id);
  };

  // Prepare then auto-draft if evidence is found
  const handlePrepareAndDraft = async () => {
    if (!openSectionId) return;
    setSubLoading('prepare');
    setLoadingLabel('Scanning project materials…');
    onError(null);
    try {
      const prepResult = await api.preparePDDSection(initiativeId, openSectionId);

      if (prepResult.evidence.length === 0) {
        // No docs found — show the no-evidence state
        const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
        if (ws) onUpdate(ws);
        setNoEvidence(true);
        setSubLoading(null);
        setLoadingLabel('');
        return;
      }

      // Evidence found — immediately draft
      setSubLoading('draft');
      setLoadingLabel('Drafting section…');
      await api.draftPDDSection(initiativeId, openSectionId);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
    } catch (e: any) {
      onError(e.message || 'Preparation failed');
    } finally {
      setSubLoading(null);
      setLoadingLabel('');
    }
  };

  const handleDraftGeneral = async () => {
    if (!openSectionId) return;
    setSubLoading('draft');
    setLoadingLabel('Drafting with general guidance…');
    onError(null);
    try {
      await api.draftPDDSection(initiativeId, openSectionId, undefined, true);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
      setNoEvidence(false);
    } catch (e: any) {
      onError(e.message || 'Drafting failed');
    } finally {
      setSubLoading(null);
      setLoadingLabel('');
    }
  };

  const handleUpdateDraft = async () => {
    if (!openSectionId || !updateAnswers.trim()) return;
    setSubLoading('update');
    setLoadingLabel('Updating draft…');
    onError(null);
    try {
      await api.draftPDDSection(initiativeId, openSectionId, { context: updateAnswers });
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
      setUpdateAnswers('');
    } catch (e: any) {
      onError(e.message || 'Update failed');
    } finally {
      setSubLoading(null);
      setLoadingLabel('');
    }
  };

  const handleRedraft = async () => {
    if (!openSectionId) return;
    setSubLoading('draft');
    setLoadingLabel('Redrafting…');
    onError(null);
    try {
      await api.draftPDDSection(initiativeId, openSectionId);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
    } catch (e: any) {
      onError(e.message || 'Redraft failed');
    } finally {
      setSubLoading(null);
      setLoadingLabel('');
    }
  };

  const handleConfirmSection = async () => {
    if (!openSectionId) return;
    setSubLoading('confirm');
    onError(null);
    try {
      const result = await api.confirmPDDSection(initiativeId, openSectionId);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) {
        onUpdate(ws);
        if (result.next_section_id) {
          handleOpenSection(result.next_section_id);
        } else {
          setOpenSectionId(null);
        }
      }
    } catch (e: any) {
      onError(e.message || 'Confirm failed');
    } finally {
      setSubLoading(null);
    }
  };

  /* ── Section list ── */
  if (!openSectionId) {
    return (
      <>
        <div className="px-5 py-4 bg-surface-header border-b border-divider">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text-primary">Sections</h3>
            <span className="text-[10px] text-text-tertiary">{confirmedCount}/{outline.length} approved</span>
          </div>
          <div className="h-1 rounded-full bg-stroke-subtle overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${outline.length ? (confirmedCount / outline.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {outline.map((s) => {
            const st = (sections[s.id]?.status || 'pending') as keyof typeof SECTION_STATUS_CONFIG;
            const cfg = SECTION_STATUS_CONFIG[st] || SECTION_STATUS_CONFIG.pending;
            return (
              <div
                key={s.id}
                onClick={() => handleOpenSection(s.id)}
                className="rounded border border-stroke-subtle hover:border-accent/30 cursor-pointer transition-colors"
              >
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {st === 'confirmed' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : st === 'drafted' ? (
                      <Circle className="w-4 h-4 text-amber-500" />
                    ) : st === 'prepared' ? (
                      <Circle className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Circle className="w-4 h-4 text-divider" />
                    )}
                  </div>
                  <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">{s.title}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
                      {cfg.label}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  /* ── Section detail ── */
  const isWorking = !!subLoading;

  return (
    <>
      {/* Header with back nav */}
      <div className="px-5 py-3 bg-surface-header border-b border-divider flex items-center gap-3">
        <button
          onClick={() => setOpenSectionId(null)}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Sections
        </button>
        <span className="text-text-tertiary text-xs">/</span>
        <span className="text-xs font-medium text-text-primary truncate">{openSection?.title}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* ── Working state (prepare + auto-draft in progress) ── */}
        {isWorking && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
            <p className="text-xs text-text-tertiary">{loadingLabel || 'Working…'}</p>
          </div>
        )}

        {/* ── Pending: empty state ── */}
        {!isWorking && sectionStatus === 'pending' && !noEvidence && isActive && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <FileSearch className="w-8 h-8 text-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-text-primary">Prepare this section</p>
              <p className="text-xs text-text-tertiary mt-1 max-w-[220px] mx-auto">
                We'll scan your project materials and draft a first version automatically.
              </p>
            </div>
            <button
              onClick={handlePrepareAndDraft}
              className="btn-primary !text-xs !px-4 !py-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              Start preparation
            </button>
          </div>
        )}

        {/* ── No evidence found ── */}
        {!isWorking && noEvidence && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <FolderOpen className="w-8 h-8 text-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-text-primary">No project documents found</p>
              <p className="text-xs text-text-tertiary mt-1 max-w-[240px] mx-auto">
                Upload documents to your project for a grounded draft, or generate a template-style draft using general guidance.
              </p>
            </div>
            {isActive && (
              <button
                onClick={handleDraftGeneral}
                className="btn-primary !text-xs !px-4 !py-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />
                Draft with general guidance
              </button>
            )}
          </div>
        )}

        {/* ── Drafted / confirmed content ── */}
        {!isWorking && (sectionStatus === 'drafted' || sectionStatus === 'confirmed') && sectionState && (
          <>
            {sectionState.evidence.length > 0 && (
              <EvidencePanel evidence={sectionState.evidence} notes={sectionState.evidence_notes} />
            )}

            {sectionState.missing_items.length > 0 && (
              <div>
                <h5 className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1.5">
                  Missing Information ({sectionState.missing_items.length})
                </h5>
                <ul className="space-y-1">
                  {sectionState.missing_items.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{m}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sectionState.draft && (
              <DraftPanel
                draft={sectionState.draft}
                confidence={sectionState.confidence}
                unsupportedClaims={sectionState.unsupported_claims}
              />
            )}

            {/* Inline "add context to improve draft" input */}
            {isActive && sectionStatus === 'drafted' && (
              <div className="border border-stroke-subtle rounded-lg overflow-hidden">
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Add missing information
                </p>
                <textarea
                  rows={3}
                  placeholder="Provide any context, corrections, or missing details and we'll update the draft…"
                  value={updateAnswers}
                  onChange={(e) => setUpdateAnswers(e.target.value)}
                  className="w-full text-xs text-text-primary bg-transparent px-3 py-2 focus:outline-none resize-none"
                />
                <div className="px-3 pb-3 flex justify-end">
                  <button
                    onClick={handleUpdateDraft}
                    disabled={!updateAnswers.trim()}
                    className="btn-primary !text-xs !px-4 !py-1.5"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Update draft
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer: redraft + approve */}
      {!isWorking && sectionStatus === 'drafted' && isActive && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
          <button
            onClick={handleRedraft}
            disabled={isWorking}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-accent transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Redraft
          </button>
          <button
            onClick={handleConfirmSection}
            disabled={isWorking}
            className="btn-primary !text-xs !px-4 !py-1.5"
          >
            {subLoading === 'confirm' ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Approving…</>
            ) : (
              <><Check className="w-3.5 h-3.5" />Approve Section</>
            )}
          </button>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/*  4. Consistency Review View                                               */
/* ========================================================================= */

function ConsistencyView({ workspace, initiativeId, isActive, loading, onLoading, onError, onUpdate }: SubViewProps) {
  const [findings, setFindings] = useState<PDDConsistencyFinding[]>(workspace.consistency_findings || []);
  const [hasRun, setHasRun] = useState(workspace.consistency_findings.length > 0);

  const handleRunCheck = async () => {
    onLoading(true);
    onError(null);
    try {
      const result = await api.runPDDConsistency(initiativeId);
      setFindings(result.findings);
      setHasRun(true);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
    } catch (e: any) {
      onError(e.message || 'Consistency check failed');
    } finally {
      onLoading(false);
    }
  };

  const handleAssemble = async () => {
    onLoading(true);
    onError(null);
    try {
      await api.assemblePDD(initiativeId);
      const { workspace: ws } = await api.getPDDWorkspace(initiativeId);
      if (ws) onUpdate(ws);
    } catch (e: any) {
      onError(e.message || 'Assembly failed');
    } finally {
      onLoading(false);
    }
  };

  const severityIcon = (s: string) => {
    if (s === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
    if (s === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
    return <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
  };

  return (
    <>
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Consistency Review</h3>
        </div>
        <p className="text-xs text-text-secondary">
          Check the full PDD for internal consistency before final assembly.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {!hasRun && (
          <div className="text-center py-8">
            <p className="text-xs text-text-tertiary mb-4">
              All sections have been drafted. Run a consistency check to catch contradictions before assembly.
            </p>
            <button
              onClick={handleRunCheck}
              disabled={loading}
              className="btn-primary !text-xs !px-4 !py-1.5"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  Run Consistency Check
                </>
              )}
            </button>
          </div>
        )}

        {hasRun && findings.length === 0 && (
          <div className="text-center py-8">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-text-primary">No issues found</p>
            <p className="text-xs text-text-tertiary mt-1">Your PDD is internally consistent.</p>
          </div>
        )}

        {hasRun && findings.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <span>{findings.filter((f) => f.severity === 'error').length} errors</span>
              <span>&middot;</span>
              <span>{findings.filter((f) => f.severity === 'warning').length} warnings</span>
              <span>&middot;</span>
              <span>{findings.filter((f) => f.severity === 'info').length} info</span>
            </div>
            {findings.map((f) => (
              <div key={f.id} className="bg-surface-subtle rounded-lg px-4 py-3">
                <div className="flex items-start gap-2">
                  {severityIcon(f.severity)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary">{f.description}</p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">
                      {f.category} &middot; Affects: {f.affected_sections.join(', ')}
                    </p>
                    <p className="text-[11px] text-text-secondary mt-1">{f.suggestion}</p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {hasRun && isActive && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
          <button
            onClick={handleRunCheck}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-accent transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Re-check
          </button>
          <button
            onClick={handleAssemble}
            disabled={loading}
            className="btn-primary !text-xs !px-4 !py-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Assembling...
              </>
            ) : (
              <>
                <ArrowRight className="w-3.5 h-3.5" />
                Assemble PDD
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/*  5. Assembly / Final View                                                 */
/* ========================================================================= */

function AssemblyView({
  workspace,
  initiativeId,
  isActive,
  loading,
  onLoading,
  onError,
}: Omit<SubViewProps, 'onUpdate'>) {
  const assembled = workspace.assembled_document;
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    onError(null);
    try {
      const blob = await api.exportPDD(initiativeId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project_design_document.docx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: any) {
      onError(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (!assembled) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-text-tertiary">No assembled document found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">{assembled.title}</h3>
        </div>
        <p className="text-xs text-text-secondary">
          {assembled.section_count} sections &middot; {assembled.citation_count} citations
          {assembled.unresolved_gaps.length > 0 && (
            <span className="text-amber-600"> &middot; {assembled.unresolved_gaps.length} unresolved items</span>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {/* Sections */}
        {assembled.sections.map((section) => (
          <div key={section.id}>
            <h4 className="text-sm font-semibold text-text-primary mb-2">{section.title}</h4>
            {section.confidence && section.confidence !== 'high' && (
              <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-2 ${
                section.confidence === 'low'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-amber-50 text-amber-600'
              }`}>
                {section.confidence} confidence
              </span>
            )}
            <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">
              {section.content}
            </div>
            {section.unsupported_claims.length > 0 && (
              <div className="mt-2 bg-amber-50 rounded px-3 py-2">
                <p className="text-[10px] font-semibold text-amber-700 mb-1">Unverified claims:</p>
                <ul className="space-y-0.5">
                  {section.unsupported_claims.map((c, i) => (
                    <li key={i} className="text-[11px] text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

        {/* Citations */}
        {assembled.citations.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-2">References</h4>
            <div className="space-y-1">
              {assembled.citations.map((c) => (
                <p key={c.number} className="text-[11px] text-text-secondary">
                  [{c.number}] <span className="font-medium">{c.source_title}</span> ({c.source_type})
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Unresolved gaps */}
        {assembled.unresolved_gaps.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-amber-700 mb-2">Unresolved Items</h4>
            <ul className="space-y-1">
              {assembled.unresolved_gaps.map((gap, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {gap}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {isActive && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider flex justify-end">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary !text-xs !px-4 !py-1.5"
          >
            {exporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Export DOCX
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}

/* ========================================================================= */
/*  Shared sub-components                                                    */
/* ========================================================================= */

function EvidencePanel({
  evidence,
  notes,
}: {
  evidence: PDDEvidenceItem[];
  notes?: { citation_key: number; note: string }[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Evidence ({evidence.length} sources)
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {evidence.map((ev) => {
            const note = notes?.find((n) => n.citation_key === ev.citation_key);
            return (
              <div key={ev.chunk_id} className="bg-surface-subtle rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-mono text-accent">[{ev.citation_key}]</span>
                  <span className="text-[10px] text-text-tertiary">{ev.source_type}</span>
                  <span className="text-[10px] font-medium text-text-primary truncate">{ev.source_title}</span>
                </div>
                <p className="text-[11px] text-text-secondary line-clamp-3">{ev.excerpt}</p>
                {note && (
                  <p className="text-[10px] text-accent mt-1 italic">{note.note}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DraftPanel({
  draft,
  confidence,
  unsupportedClaims,
}: {
  draft: string;
  confidence: string | null;
  unsupportedClaims: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h5 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Draft</h5>
        {confidence && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            confidence === 'high'
              ? 'bg-green-50 text-green-600'
              : confidence === 'low'
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-600'
          }`}>
            {confidence} confidence
          </span>
        )}
      </div>
      <div className="bg-white border border-stroke-subtle rounded-lg px-4 py-3 text-xs text-text-primary leading-relaxed whitespace-pre-wrap">
        {draft}
      </div>
      {unsupportedClaims.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold text-amber-600 mb-1">Needs verification:</p>
          <ul className="space-y-0.5">
            {unsupportedClaims.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700">
                <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

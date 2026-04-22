'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, User, Trash2, Undo2, RotateCcw, Plus } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/ModulePicker';
import { api, type ModuleInstance } from '@/lib/api';

const MODULE_MAP = new Map(ALL_MODULES.map((m) => [m.id, m]));

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatEmail(email: string | null, fallback: string): string {
  if (email) return email;
  return fallback.length > 16 ? `${fallback.slice(0, 8)}…` : fallback;
}

interface OpenModuleBrowserProps {
  initiativeId: string;
  onSelect: (instance: ModuleInstance) => void;
  onSwitchToNew?: () => void;
}

type EnrichedInstance = ModuleInstance & { index: number | null; displayName: string };

function enrich(instances: ModuleInstance[]): EnrichedInstance[] {
  return instances.map((inst) => {
    const sameToolInstances = instances.filter((i) => i.module_id === inst.module_id);
    const hasDuplicates = sameToolInstances.length > 1;
    const index = hasDuplicates
      ? [...sameToolInstances]
          .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
          .findIndex((i) => i.id === inst.id) + 1
      : null;
    const mod = MODULE_MAP.get(inst.module_id);
    const displayName = mod
      ? index ? `${mod.name} #${index}` : mod.name
      : index
        ? `${inst.module_id.replace(/_/g, ' ')} #${index}`
        : inst.module_id.replace(/_/g, ' ');
    return { ...inst, index, displayName };
  });
}

export function OpenModuleBrowser({ initiativeId, onSelect, onSwitchToNew }: OpenModuleBrowserProps) {
  const [instances, setInstances] = useState<ModuleInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTrashView, setIsTrashView] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async (archived: boolean) => {
    setLoading(true);
    try {
      const data = await api.listModuleInstances(initiativeId, { archived });
      setInstances(data);
    } catch {
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    load(isTrashView);
  }, [load, isTrashView]);

  const handleTrashToggle = () => {
    setIsTrashView((v) => !v);
    setConfirmDeleteId(null);
  };

  const handleArchive = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.deleteModuleInstance(initiativeId, id);
    setInstances((prev) => prev.filter((i) => i.id !== id));
  }, [initiativeId]);

  const handleRestore = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.restoreModuleInstance(initiativeId, id);
    setInstances((prev) => prev.filter((i) => i.id !== id));
  }, [initiativeId]);

  const handlePermanentDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.permanentlyDeleteModuleInstance(initiativeId, id);
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setConfirmDeleteId(null);
  }, [initiativeId]);

  const enriched = enrich(instances);

  return (
    <div className="w-full">
      <div className="w-full pt-3 pb-8">
        {/* Keep New Module directly left of Trash in open mode */}
        <div className="mb-6 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={onSwitchToNew}
            className="btn-primary shrink-0 !h-[36px] !text-xs !leading-none !px-4 !py-0"
          >
            <Plus className="w-3 h-3" />
            New Module
          </button>
          <button
            type="button"
            onClick={handleTrashToggle}
            className={`btn-secondary shrink-0 !h-[36px] !text-xs !leading-none !px-4 !py-0 ${isTrashView ? '!border-accent !text-accent' : ''}`}
          >
            {isTrashView ? <Undo2 className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
            {isTrashView ? 'Back to Modules' : 'Trash'}
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[72px] rounded-lg bg-surface-subtle animate-pulse" />
            ))}
          </div>
        ) : enriched.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-text-secondary">
              {isTrashView ? 'Trash is empty.' : 'No modules started yet.'}
            </p>
            {!isTrashView && (
              <p className="text-xs text-text-tertiary mt-1">Use &quot;New Module&quot; to begin.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {enriched.map((inst) => {
              const mod = MODULE_MAP.get(inst.module_id);
              const authorLabel = formatEmail(inst.started_by_email, inst.started_by);
              const isConfirmingDelete = confirmDeleteId === inst.id;

              const cardClass =
                `w-full border border-black/[0.04] relative flex items-start gap-3 px-4 py-3.5 text-left group ${isTrashView ? 'card opacity-70 cursor-default' : 'card-interactive'}`;

              const cardInner = (
                <>
                  <div className="w-10 h-10 flex-shrink-0 rounded flex items-center justify-center bg-accent-wash [&>svg]:w-5 [&>svg]:h-5 text-accent">
                    {mod?.icon}
                  </div>

                  <div className="min-w-0 flex-1 pt-0.5 pr-6">
                    <p className="text-xs font-medium text-text-secondary leading-snug truncate">
                      {inst.displayName}
                    </p>
                    <div className="mt-2 flex items-center gap-2.5 text-[11px] text-text-tertiary">
                      <span className="flex items-center gap-0.5 shrink-0">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(inst.updated_at)}
                      </span>
                      <span className="flex items-center gap-0.5 min-w-0">
                        <User className="w-3 h-3 shrink-0" />
                        <span className="truncate">{authorLabel}</span>
                      </span>
                    </div>
                  </div>
                </>
              );

              return (
                <div key={inst.id} className="group relative">
                  {isTrashView ? (
                    <div className={cardClass}>
                      {cardInner}
                      <button
                        type="button"
                        onClick={(e) => handleRestore(e, inst.id)}
                        title="Restore"
                        className="project-action-btn project-action-btn-success absolute top-2 right-9 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-green transition-opacity z-10"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(inst.id);
                        }}
                        title="Permanently delete"
                        className="project-action-btn project-action-btn-danger absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange transition-opacity z-10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button type="button" onClick={() => onSelect(inst)} className={cardClass}>
                        {cardInner}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleArchive(e, inst.id)}
                        title="Move to trash"
                        className="project-action-btn project-action-btn-danger absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange transition-opacity z-10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  {/* Permanent delete confirmation overlay */}
                  {isConfirmingDelete && (
                    <div className="absolute inset-0 bg-surface rounded-lg border border-divider flex flex-col items-center justify-center gap-3 p-4 z-20">
                      <div className="text-center">
                        <p className="text-xs font-semibold text-text-primary">Permanently delete?</p>
                      </div>
                      <div className="flex gap-2 w-full">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          className="btn-secondary flex-1 !py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handlePermanentDelete(e, inst.id)}
                          className="btn-danger flex-1 !py-1.5 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

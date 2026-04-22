'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Loader2, Trash2 } from 'lucide-react';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { type ModuleInstance, api } from '@/lib/api';
import { useSettingsStore } from '@/stores/settingsStore';

interface FrameworkPlanViewProps {
  initiativeId: string;
  readOnly?: boolean;
  onOpenModule: (module: ModuleInstance) => void;
}

interface FrameworkPhase {
  id: string;
  name: string;
}

const PHASE_MATCHERS: Record<string, string[]> = {
  opportunity: ['opportunity discovery', 'opportunity'],
  definition: ['project definition', 'definition'],
  feasibility: ['feasibility', 'option analysis', 'option'],
  impact: ['impact assessment', 'impact'],
  compliance: ['compliance', 'delivery readiness', 'delivery'],
};

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function getFrameworkPhases(): FrameworkPhase[] {
  return MODULE_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
  }));
}

function resolvePhaseIdForModule(moduleId: string, phases: FrameworkPhase[]): string {
  const category = MODULE_CATEGORIES.find((candidate) => candidate.moduleIds.includes(moduleId));
  if (!category) return phases[0]?.id ?? 'unassigned';

  const exactPhase = phases.find((phase) => normalizeLabel(phase.name) === normalizeLabel(category.name));
  if (exactPhase) return exactPhase.id;

  const matcher = PHASE_MATCHERS[category.id] ?? [];
  const fuzzyPhase = phases.find((phase) => matcher.some((term) => normalizeLabel(phase.name).includes(term)));
  if (fuzzyPhase) return fuzzyPhase.id;

  const sameIdPhase = phases.find((phase) => phase.id === category.id);
  if (sameIdPhase) return sameIdPhase.id;

  return phases[0]?.id ?? category.id;
}

export function FrameworkPlanView({
  initiativeId,
  readOnly = false,
  onOpenModule,
}: FrameworkPlanViewProps) {
  const devMode = useSettingsStore((s) => s.devMode);
  const [instances, setInstances] = useState<ModuleInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creatingModuleId, setCreatingModuleId] = useState<string | null>(null);
  const [removingInstanceId, setRemovingInstanceId] = useState<string | null>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  const phases = useMemo(() => getFrameworkPhases(), []);

  const moduleMetaById = useMemo(
    () => new Map(ALL_MODULES.map((module) => [module.id, module])),
    [],
  );

  const visibleCategories = useMemo(
    () => MODULE_CATEGORIES.map((category) => ({
      ...category,
      modules: category.moduleIds
        .map((moduleId) => moduleMetaById.get(moduleId))
        .filter((module): module is NonNullable<typeof module> => Boolean(module) && (devMode || !module.beta)),
    })).filter((category) => devMode || category.modules.length > 0),
    [devMode, moduleMetaById],
  );

  useEffect(() => {
    let cancelled = false;

    const loadInstances = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.listModuleInstances(initiativeId);
        if (!cancelled) {
          setInstances(data);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load modules.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadInstances();
    return () => {
      cancelled = true;
    };
  }, [initiativeId]);

  useEffect(() => {
    if (!libraryOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!libraryRef.current?.contains(event.target as Node)) {
        setLibraryOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [libraryOpen]);

  const groupedPhases = useMemo(() => {
    const buckets = new Map(phases.map((phase) => [phase.id, [] as ModuleInstance[]]));
    const unmatched: ModuleInstance[] = [];

    instances.forEach((instance) => {
      const phaseId = resolvePhaseIdForModule(instance.module_id, phases);
      const bucket = buckets.get(phaseId);
      if (bucket) {
        bucket.push(instance);
      } else {
        unmatched.push(instance);
      }
    });

    const result = phases.map((phase) => ({
      ...phase,
      modules: (buckets.get(phase.id) ?? []).sort((a, b) => (
        new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      )),
    })).filter((phase) => phase.modules.length > 0);

    if (unmatched.length > 0) {
      result.push({
        id: 'unassigned',
        name: 'Other Modules',
        modules: unmatched,
      });
    }

    return result;
  }, [instances, phases]);

  const existingModuleIds = useMemo(
    () => new Set(instances.map((instance) => instance.module_id)),
    [instances],
  );

  const handleCreateModule = async (moduleId: string) => {
    if (existingModuleIds.has(moduleId)) {
      setError('That module is already in this framework plan.');
      return;
    }
    setCreatingModuleId(moduleId);
    setError(null);
    try {
      const instance = await api.createModuleInstance(initiativeId, moduleId);
      setInstances((prev) => [...prev, instance]);
      setLibraryOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create module.');
    } finally {
      setCreatingModuleId(null);
    }
  };

  const handleRemoveModule = async (instanceId: string) => {
    if (removingInstanceId) return;
    setRemovingInstanceId(instanceId);
    setError(null);
    try {
      await api.deleteModuleInstance(initiativeId, instanceId);
      setInstances((prev) => prev.filter((instance) => instance.id !== instanceId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to remove module.');
    } finally {
      setRemovingInstanceId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 bg-surface">
        <div className="flex items-start justify-end gap-4">
          {!readOnly && (
            <div ref={libraryRef} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setLibraryOpen((open) => !open)}
                className="btn-secondary !px-3 !py-1.5 !text-xs"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Module Library
              </button>

              {libraryOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-[360px] max-h-[420px] overflow-y-auto rounded-xl border border-divider bg-white shadow-lg">
                  <div className="px-4 pt-3 pb-2 border-b border-divider">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                      Add Module
                    </p>
                  </div>

                  <div className="p-2">
                    {visibleCategories.map((category) => (
                      <div key={category.id} className="mb-2 last:mb-0">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                          {category.name}
                        </p>
                        <div className="space-y-1">
                          {category.modules.map((module) => {
                            const isCreating = creatingModuleId === module.id;
                            const alreadyAdded = existingModuleIds.has(module.id);
                            return (
                              <button
                                key={module.id}
                                type="button"
                                disabled={isCreating || alreadyAdded}
                                onClick={() => handleCreateModule(module.id)}
                                className="w-full rounded-lg px-3 py-2 text-left transition-colors enabled:hover:bg-surface-subtle disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                <div className="flex items-center gap-2.5">
                                  <span className="text-accent">
                                    {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : module.icon}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-medium text-text-primary">
                                      {module.name}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] leading-snug text-text-tertiary">
                                      {alreadyAdded ? 'Already in this framework plan' : module.description}
                                    </span>
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs text-indicator-orange">{error}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <div className="h-full w-full px-6 pt-8 pb-4">
            <div className="flex w-max min-w-full justify-center gap-12 items-start">
              {groupedPhases.map((phase) => (
                <section
                  key={phase.id}
                  className="w-[280px] flex-shrink-0"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 px-0.5">
                    {phase.name}
                  </p>
                  <div className="space-y-4 min-h-[220px]">
                    {phase.modules.map((instance) => {
                      const moduleMeta = moduleMetaById.get(instance.module_id);
                      const moduleName = moduleMeta?.name || instance.module_id.replace(/_/g, ' ');
                      const isRemoving = removingInstanceId === instance.id;

                      return (
                        <div
                          key={instance.id}
                          className="group relative card-interactive border border-black/[0.04]"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenModule(instance)}
                            className="relative flex w-full items-center gap-3 px-4 py-3.5 text-left"
                          >
                            <div className="w-10 h-10 flex-shrink-0 rounded flex items-center justify-center bg-accent-wash">
                              <span className="[&>svg]:w-5 [&>svg]:h-5 text-accent">
                                {moduleMeta?.icon}
                              </span>
                            </div>
                            <span className="text-xs font-medium text-text-secondary leading-snug text-left">
                              {moduleName}
                            </span>
                          </button>
                          {!readOnly && (
                            <button
                              type="button"
                              disabled={isRemoving}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRemoveModule(instance.id);
                              }}
                              title="Remove from framework plan"
                              className="project-action-btn project-action-btn-danger absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange transition-opacity z-10 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isRemoving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

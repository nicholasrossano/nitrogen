'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, Plus } from 'lucide-react';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { type ModuleInstance, type ProjectPlan, api } from '@/lib/api';
import { useSettingsStore } from '@/stores/settingsStore';

interface FrameworkPlanViewProps {
  initiativeId: string;
  projectPlan: ProjectPlan | null;
  readOnly?: boolean;
  onOpenModule: (module: ModuleInstance) => void;
}

interface FrameworkPhase {
  id: string;
  name: string;
  description?: string;
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

function getFrameworkPhases(projectPlan: ProjectPlan | null): FrameworkPhase[] {
  if (projectPlan?.phases?.length) {
    return projectPlan.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      description: phase.description,
    }));
  }

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

function formatModuleStatus(status: ModuleInstance['status']): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'ready':
      return 'Ready';
    case 'generating':
      return 'Generating';
    case 'started':
      return 'In progress';
    case 'error':
      return 'Needs attention';
    case 'draft':
    default:
      return 'Not started';
  }
}

export function FrameworkPlanView({
  initiativeId,
  projectPlan,
  readOnly = false,
  onOpenModule,
}: FrameworkPlanViewProps) {
  const devMode = useSettingsStore((s) => s.devMode);
  const [instances, setInstances] = useState<ModuleInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creatingModuleId, setCreatingModuleId] = useState<string | null>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  const phases = useMemo(() => getFrameworkPhases(projectPlan), [projectPlan]);

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
    }));

    if (unmatched.length > 0) {
      result.push({
        id: 'unassigned',
        name: 'Other Modules',
        modules: unmatched,
      });
    }

    return result;
  }, [instances, phases]);

  const completedCount = useMemo(
    () => instances.filter((instance) => instance.status === 'complete').length,
    [instances],
  );

  const handleCreateModule = async (moduleId: string) => {
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

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-divider bg-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Framework Plan</h2>
            <p className="mt-1 text-xs text-text-tertiary">
              Organize project work by phase, then open each module to complete it.
            </p>
          </div>

          {!readOnly && (
            <div ref={libraryRef} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setLibraryOpen((open) => !open)}
                className="btn-secondary !px-3 !py-1.5 !text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Module Library
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${libraryOpen ? 'rotate-180' : ''}`} />
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
                            return (
                              <button
                                key={module.id}
                                type="button"
                                disabled={isCreating}
                                onClick={() => handleCreateModule(module.id)}
                                className="w-full rounded-lg px-3 py-2 text-left transition-colors enabled:hover:bg-surface-subtle disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                <div className="flex items-start gap-2.5">
                                  <span className="mt-0.5 text-accent">
                                    {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : module.icon}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-medium text-text-primary">
                                      {module.name}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] leading-snug text-text-tertiary">
                                      {module.description}
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

        <div className="mt-3 flex items-center gap-3 text-xs text-text-tertiary">
          <span>{instances.length} modules</span>
          <span className="text-divider">•</span>
          <span>{completedCount} complete</span>
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
          <div className="h-full min-w-max px-4 py-4">
            <div className="flex h-full gap-4 items-stretch">
              {groupedPhases.map((phase) => (
                <section
                  key={phase.id}
                  className="w-[280px] flex-shrink-0 rounded-xl border border-divider bg-white/80 shadow-subtle overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-divider bg-surface-subtle/60">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-medium text-text-primary">{phase.name}</h3>
                      <span className="text-[11px] text-text-tertiary">{phase.modules.length}</span>
                    </div>
                    {phase.description && (
                      <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                        {phase.description}
                      </p>
                    )}
                  </div>

                  <div className="p-3 space-y-2 min-h-[220px]">
                    {phase.modules.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-divider px-3 py-4 text-center text-xs text-text-tertiary">
                        No modules in this phase yet.
                      </div>
                    ) : (
                      phase.modules.map((instance) => {
                        const moduleMeta = moduleMetaById.get(instance.module_id);
                        const isComplete = instance.status === 'complete';
                        const moduleTitle = instance.title || moduleMeta?.name || instance.module_id.replace(/_/g, ' ');

                        return (
                          <button
                            key={instance.id}
                            type="button"
                            onClick={() => onOpenModule(instance)}
                            className="card-interactive w-full border border-black/[0.05] px-3 py-3 text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-text-primary leading-snug">
                                  {moduleTitle}
                                </p>
                                <p className="mt-1 text-[11px] leading-snug text-text-tertiary">
                                  {moduleMeta?.description ?? 'Open this module to continue work.'}
                                </p>
                              </div>
                              {isComplete && (
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-500" />
                              )}
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                isComplete
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : instance.status === 'error'
                                    ? 'bg-red-50 text-red-600'
                                    : instance.status === 'generating'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-surface-subtle text-text-secondary'
                              }`}
                              >
                                {formatModuleStatus(instance.status)}
                              </span>
                              <span className="text-[10px] text-text-tertiary">
                                Open
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
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

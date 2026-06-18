'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Search, Trash2 } from 'lucide-react';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/AssessmentPicker';
import { PageLoader, UniversalLoadingIcon } from '@/components/ui/PageLoader';
import { type AssessmentInstance } from '@/lib/api';
import { filterVisibleAssessments } from '@/lib/featureFlags';
import { useFeatureFlag, useFeatureFlagContext } from '@/hooks/useFeatureFlag';
import { AssessmentInstanceOpenDropdown } from './AssessmentInstanceOpenDropdown';

interface FrameworkPlanViewProps {
  plannedAssessmentIds: string[];
  assessmentInstances: AssessmentInstance[];
  loading: boolean;
  onAddAssessmentToFrameworkPlan: (assessmentId: string) => Promise<void>;
  onRemoveAssessmentFromFrameworkPlan: (assessmentId: string) => Promise<void>;
  onCreateAssessmentInstanceInAssessmentsView: (assessmentId: string, assessmentName: string) => Promise<void>;
  onOpenExistingAssessmentInstanceInAssessmentsView: (instance: AssessmentInstance) => Promise<void>;
  readOnly?: boolean;
  onOpenAssessment: (assessment: AssessmentInstance) => void;
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

function resolvePhaseIdForAssessment(assessmentId: string, phases: FrameworkPhase[]): string {
  const category = MODULE_CATEGORIES.find((candidate) => candidate.assessmentIds.includes(assessmentId));
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
  plannedAssessmentIds,
  assessmentInstances,
  loading,
  onAddAssessmentToFrameworkPlan,
  onRemoveAssessmentFromFrameworkPlan,
  onCreateAssessmentInstanceInAssessmentsView,
  onOpenExistingAssessmentInstanceInAssessmentsView,
  readOnly = false,
  onOpenAssessment,
}: FrameworkPlanViewProps) {
  const showBetaAssessments = useFeatureFlag('beta_assessments');
  const featureFlagContext = useFeatureFlagContext();
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [assessmentSearchQuery, setAssessmentSearchQuery] = useState('');
  const [creatingAssessmentId, setCreatingAssessmentId] = useState<string | null>(null);
  const [removingPlannedAssessmentId, setRemovingPlannedAssessmentId] = useState<string | null>(null);
  const [creatingWorkspaceAssessmentId, setCreatingWorkspaceAssessmentId] = useState<string | null>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  const phases = useMemo(() => getFrameworkPhases(), []);

  const assessmentMetaById = useMemo(
    () => new Map(ALL_MODULES.map((assessment) => [assessment.id, assessment])),
    [],
  );

  const visibleCategories = useMemo(
    () => MODULE_CATEGORIES.map((category) => ({
      ...category,
      assessments: filterVisibleAssessments(
        category.assessmentIds
          .map((assessmentId) => assessmentMetaById.get(assessmentId))
          .filter(
            (
              assessment,
            ): assessment is NonNullable<(typeof ALL_MODULES)[number]> => Boolean(assessment),
          ),
        featureFlagContext,
      ),
    })).filter((category) => showBetaAssessments || category.assessments.length > 0),
    [showBetaAssessments, assessmentMetaById, featureFlagContext],
  );

  const filteredCategories = useMemo(() => {
    const query = assessmentSearchQuery.trim().toLowerCase();
    if (!query) return visibleCategories;

    return visibleCategories
      .map((category) => ({
        ...category,
        assessments: category.assessments.filter((assessment) => (
          assessment.name.toLowerCase().includes(query)
          || assessment.description.toLowerCase().includes(query)
          || category.name.toLowerCase().includes(query)
        )),
      }))
      .filter((category) => category.assessments.length > 0);
  }, [assessmentSearchQuery, visibleCategories]);

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
    const buckets = new Map(phases.map((phase) => [phase.id, [] as string[]]));
    const unmatched: string[] = [];

    plannedAssessmentIds.forEach((assessmentId) => {
      const phaseId = resolvePhaseIdForAssessment(assessmentId, phases);
      const bucket = buckets.get(phaseId);
      if (bucket) {
        bucket.push(assessmentId);
      } else {
        unmatched.push(assessmentId);
      }
    });

    const result = phases.map((phase) => ({
      ...phase,
      assessments: buckets.get(phase.id) ?? [],
    })).filter((phase) => phase.assessments.length > 0);

    if (unmatched.length > 0) {
      result.push({
        id: 'unassigned',
        name: 'Other Assessments',
        assessments: unmatched,
      });
    }

    return result;
  }, [plannedAssessmentIds, phases]);

  const existingAssessmentIds = useMemo(
    () => new Set(plannedAssessmentIds),
    [plannedAssessmentIds],
  );

  const handleCreateAssessment = useCallback(async (assessmentId: string) => {
    if (existingAssessmentIds.has(assessmentId)) {
      setError('That assessment is already in this framework plan.');
      return;
    }
    setCreatingAssessmentId(assessmentId);
    setError(null);
    try {
      await onAddAssessmentToFrameworkPlan(assessmentId);
      setLibraryOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create assessment.');
    } finally {
      setCreatingAssessmentId(null);
    }
  }, [existingAssessmentIds, onAddAssessmentToFrameworkPlan]);

  const handleRemoveAssessmentFromPlan = useCallback(async (assessmentId: string) => {
    if (removingPlannedAssessmentId) return;
    setRemovingPlannedAssessmentId(assessmentId);
    setError(null);
    try {
      await onRemoveAssessmentFromFrameworkPlan(assessmentId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to remove assessment from plan.');
    } finally {
      setRemovingPlannedAssessmentId(null);
    }
  }, [onRemoveAssessmentFromFrameworkPlan, removingPlannedAssessmentId]);

  const handleCreateAssessmentInAssessmentsView = useCallback(async (assessmentId: string, assessmentName: string) => {
    if (creatingWorkspaceAssessmentId) return;
    setCreatingWorkspaceAssessmentId(assessmentId);
    setError(null);
    try {
      await onCreateAssessmentInstanceInAssessmentsView(assessmentId, assessmentName);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create assessment instance.');
    } finally {
      setCreatingWorkspaceAssessmentId(null);
    }
  }, [creatingWorkspaceAssessmentId, onCreateAssessmentInstanceInAssessmentsView]);

  const handleOpenExistingInstance = useCallback(async (instance: AssessmentInstance) => {
    setError(null);
    try {
      await onOpenExistingAssessmentInstanceInAssessmentsView(instance);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to open assessment instance.');
    }
  }, [onOpenExistingAssessmentInstanceInAssessmentsView]);

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
                Assessment Library
              </button>

              {libraryOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-[360px] max-h-[420px] overflow-y-auto rounded-xl border border-divider bg-white shadow-lg">
                  <div className="sticky top-0 z-10 bg-white px-4 pt-3 pb-2 border-b border-divider">
                    <label htmlFor="assessment-library-search" className="sr-only">
                      Search assessments
                    </label>
                    <div className="flex items-center gap-2 rounded-lg border border-divider bg-surface-subtle px-3 py-2">
                      <Search className="w-3.5 h-3.5 flex-shrink-0 text-text-tertiary" />
                      <input
                        id="assessment-library-search"
                        type="search"
                        value={assessmentSearchQuery}
                        onChange={(event) => setAssessmentSearchQuery(event.target.value)}
                        placeholder="Search assessments..."
                        className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-2">
                    {filteredCategories.length === 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-text-tertiary">
                        No assessments match your search.
                      </p>
                    ) : filteredCategories.map((category) => (
                      <div key={category.id} className="mb-2 last:mb-0">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                          {category.name}
                        </p>
                        <div className="space-y-1">
                          {category.assessments.map((assessment) => {
                            const isCreating = creatingAssessmentId === assessment.id;
                            const alreadyAdded = existingAssessmentIds.has(assessment.id);
                            return (
                              <button
                                key={assessment.id}
                                type="button"
                                disabled={isCreating || alreadyAdded}
                                onClick={() => handleCreateAssessment(assessment.id)}
                                className="w-full rounded-lg px-3 py-2 text-left transition-colors enabled:hover:bg-surface-subtle disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                <div className="flex items-center gap-2.5">
                                  <span className="text-accent">
                                    {isCreating ? <UniversalLoadingIcon size={16} /> : assessment.icon}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-medium text-text-primary">
                                      {assessment.name}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] leading-snug text-text-tertiary">
                                      {alreadyAdded ? 'Already in this framework plan' : assessment.description}
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

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <PageLoader label="" />
          </div>
        ) : (
          <div className="w-full px-6 pt-6 pb-10">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
              {groupedPhases.map((phase) => (
                <section
                  key={phase.id}
                  className="rounded-2xl border border-stroke-subtle bg-white/70 p-4"
                >
                  <div className="mb-4 -mx-4 border-b border-stroke-subtle px-4 pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                        {phase.name}
                      </p>
                      <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[11px] font-medium text-text-tertiary">
                        {phase.assessments.length}
                        {' '}
                        {phase.assessments.length === 1 ? 'assessment' : 'assessments'}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {phase.assessments.map((assessmentId) => {
                      const assessmentMeta = assessmentMetaById.get(assessmentId);
                      const assessmentName = assessmentMeta?.name || assessmentId.replace(/_/g, ' ');
                      const isRemoving = removingPlannedAssessmentId === assessmentId;
                      const isCreatingWorkspace = creatingWorkspaceAssessmentId === assessmentId;
                      const assessmentInstancesForType = assessmentInstances
                        .filter((candidate) => candidate.assessment_id === assessmentId)
                        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
                      const completedInstances = assessmentInstancesForType.filter(
                        (candidate) => candidate.is_plan_complete === true,
                      );
                      const completedInstance = completedInstances[0] ?? null;
                      const isAssessmentComplete = Boolean(completedInstance);
                      const shouldOpenInstancePicker = assessmentInstancesForType.length > 1 || completedInstances.length > 1;
                      const directOpenInstance = shouldOpenInstancePicker
                        ? null
                        : completedInstance ?? assessmentInstancesForType[0] ?? null;
                      return (
                        <div
                          key={assessmentId}
                          className={[
                            'group relative card-interactive overflow-visible',
                            isAssessmentComplete
                              ? 'border border-stroke-subtle bg-accent-wash/35'
                              : 'border border-stroke-subtle',
                            'z-0',
                          ].join(' ')}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (assessmentInstancesForType.length === 0) {
                                if (!readOnly) void handleCreateAssessmentInAssessmentsView(assessmentId, assessmentName);
                                return;
                              }

                              if (shouldOpenInstancePicker) return;

                              if (directOpenInstance) onOpenAssessment(directOpenInstance);
                            }}
                            disabled={readOnly && assessmentInstancesForType.length === 0}
                            className="relative flex w-full items-center gap-3 px-4 py-3.5 text-left"
                          >
                            <div
                              className={[
                                'w-10 h-10 flex-shrink-0 rounded flex items-center justify-center',
                                isAssessmentComplete ? 'bg-accent text-white shadow-sm' : 'bg-accent-wash',
                              ].join(' ')}
                            >
                              <span
                                className={[
                                  '[&>svg]:w-5 [&>svg]:h-5',
                                  isAssessmentComplete ? 'text-white' : 'text-accent',
                                ].join(' ')}
                              >
                                {isAssessmentComplete ? <Check className="w-5 h-5" strokeWidth={2.4} /> : assessmentMeta?.icon}
                              </span>
                            </div>
                            <span className="min-w-0 flex-1">
                              <span
                                className={[
                                  'block text-xs font-medium leading-snug text-left',
                                  isAssessmentComplete ? 'text-accent' : 'text-text-secondary',
                                ].join(' ')}
                              >
                                {assessmentName}
                              </span>
                              {isAssessmentComplete && (
                                <span className="mt-1 inline-flex h-[1.375rem] items-center justify-center rounded-full border border-accent/20 bg-white/75 px-2.5 text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-accent">
                                  Confirmed
                                </span>
                              )}
                            </span>
                          </button>
                          {(assessmentInstancesForType.length > 0 || !readOnly) && (
                            <div className="px-4 pb-3 flex justify-end gap-2">
                              {assessmentInstancesForType.length > 0 && (
                                <AssessmentInstanceOpenDropdown
                                  instances={assessmentInstancesForType}
                                  onOpenInstance={handleOpenExistingInstance}
                                  getInstanceLabel={(assessmentInstance) => (
                                    assessmentInstance.display_name
                                    || assessmentInstance.title
                                    || assessmentName
                                  )}
                                />
                              )}
                              {!readOnly && (
                                <button
                                  type="button"
                                  disabled={isCreatingWorkspace}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleCreateAssessmentInAssessmentsView(assessmentId, assessmentName);
                                  }}
                                  className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg whitespace-nowrap border border-accent bg-accent text-white transition-colors enabled:hover:bg-accent-hover enabled:hover:border-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {isCreatingWorkspace ? (
                                    <>
                                      <UniversalLoadingIcon size={12} colorClassName="text-white" />
                                      Start Task
                                    </>
                                  ) : (
                                    'Start Task'
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              disabled={isRemoving}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRemoveAssessmentFromPlan(assessmentId);
                              }}
                              title="Remove assessment from framework plan"
                              className="project-action-btn project-action-btn-danger absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary enabled:hover:text-indicator-orange transition-opacity z-10 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isRemoving ? (
                                <UniversalLoadingIcon size={14} colorClassName="text-text-tertiary" />
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

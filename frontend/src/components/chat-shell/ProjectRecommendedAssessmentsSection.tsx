'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Loader2, Search } from 'lucide-react';

import {
  ALL_MODULES,
  groupAssessmentIdsByAnalysisType,
} from '@/components/chat/AssessmentPicker';
import { UniversalLoadingIcon } from '@/components/ui/PageLoader';
import { useFeatureFlag, useFeatureFlagContext, useVisibleAssessments } from '@/hooks/useFeatureFlag';
import { api, type AssessmentInstance } from '@/lib/api';
import { isAssessmentUserEngaged } from '@/lib/assessmentEngagement';
import { filterVisibleAssessments } from '@/lib/featureFlags';
import { useInitiativeStore } from '@/stores/initiativeStore';

interface ProjectRecommendedAssessmentsSectionProps {
  projectId: string;
  onOpenAssessment: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
    pendingEngagement?: boolean;
  }) => void;
  refreshKey?: number;
}

export function ProjectRecommendedAssessmentsSection({
  projectId,
  onOpenAssessment,
  refreshKey = 0,
}: ProjectRecommendedAssessmentsSectionProps) {
  const showBetaAssessments = useFeatureFlag('beta_assessments');
  const featureFlagContext = useFeatureFlagContext();
  const initiative = useInitiativeStore((state) => state.initiative);
  const visibleModules = useVisibleAssessments(ALL_MODULES);
  const visibleModuleIds = useMemo(
    () => new Set(visibleModules.map((module) => module.id)),
    [visibleModules],
  );
  const assessmentMetaById = useMemo(
    () => new Map(ALL_MODULES.map((assessment) => [assessment.id, assessment])),
    [],
  );

  const [instances, setInstances] = useState<AssessmentInstance[]>([]);
  const [recommendedAssessmentIds, setRecommendedAssessmentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingAssessmentId, setCreatingAssessmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [assessmentSearchQuery, setAssessmentSearchQuery] = useState('');
  const libraryRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [instanceData, recommendedTools] = await Promise.all([
        api.listAssessmentInstances(projectId),
        initiative?.selected_tools?.length
          ? Promise.resolve(null)
          : api.getRecommendedTools(projectId).catch(() => null),
      ]);

      setInstances(instanceData);

      const selectedTools = initiative?.selected_tools;
      if (selectedTools && selectedTools.length > 0) {
        setRecommendedAssessmentIds(Array.from(new Set(selectedTools)));
      } else if (recommendedTools?.recommendations?.length) {
        const recommendedIds = recommendedTools.recommendations
          .filter((recommendation) => recommendation.recommended !== false)
          .map((recommendation) => recommendation.tool.id);
        const fallbackIds = recommendedTools.recommendations.map((recommendation) => recommendation.tool.id);
        setRecommendedAssessmentIds(Array.from(new Set(recommendedIds.length > 0 ? recommendedIds : fallbackIds)));
      } else if (instanceData.length > 0) {
        setRecommendedAssessmentIds(Array.from(new Set(instanceData.map((instance) => instance.assessment_id))));
      } else {
        setRecommendedAssessmentIds([]);
      }
    } catch {
      setInstances([]);
      setRecommendedAssessmentIds([]);
      setError('Failed to load recommended assessments.');
    } finally {
      setLoading(false);
    }
  }, [initiative?.selected_tools, projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const handler = () => {
      void load();
    };
    window.addEventListener('nitrogen:assessment-workflow-updated', handler);
    return () => window.removeEventListener('nitrogen:assessment-workflow-updated', handler);
  }, [load]);

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

  const visibleRecommendedAssessmentIds = useMemo(
    () => recommendedAssessmentIds.filter((assessmentId) => {
      const assessmentMeta = assessmentMetaById.get(assessmentId);
      if (!visibleModuleIds.has(assessmentId)) return false;
      return showBetaAssessments || !assessmentMeta?.beta;
    }),
    [assessmentMetaById, recommendedAssessmentIds, showBetaAssessments, visibleModuleIds],
  );

  const groupedCategories = useMemo(
    () => groupAssessmentIdsByAnalysisType(visibleRecommendedAssessmentIds),
    [visibleRecommendedAssessmentIds],
  );

  const libraryTypeGroups = useMemo(
    () => groupAssessmentIdsByAnalysisType(
      filterVisibleAssessments(ALL_MODULES, featureFlagContext).map((assessment) => assessment.id),
    ).map((group) => ({
      ...group,
      assessments: group.assessmentIds
        .map((assessmentId) => assessmentMetaById.get(assessmentId))
        .filter((assessment): assessment is NonNullable<typeof assessment> => Boolean(assessment)),
    })),
    [assessmentMetaById, featureFlagContext],
  );

  const filteredLibraryGroups = useMemo(() => {
    const query = assessmentSearchQuery.trim().toLowerCase();
    if (!query) return libraryTypeGroups;

    return libraryTypeGroups
      .map((group) => ({
        ...group,
        assessments: group.assessments.filter((assessment) => (
          assessment.name.toLowerCase().includes(query)
          || assessment.description.toLowerCase().includes(query)
          || group.name.toLowerCase().includes(query)
        )),
      }))
      .filter((group) => group.assessments.length > 0);
  }, [assessmentSearchQuery, libraryTypeGroups]);

  const instancesByAssessmentId = useMemo(() => {
    const grouped = new Map<string, AssessmentInstance[]>();
    instances.forEach((instance) => {
      const current = grouped.get(instance.assessment_id) ?? [];
      current.push(instance);
      grouped.set(instance.assessment_id, current);
    });
    grouped.forEach((assessmentInstances, assessmentId) => {
      grouped.set(
        assessmentId,
        [...assessmentInstances].sort(
          (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
        ),
      );
    });
    return grouped;
  }, [instances]);

  const handleOpenAssessment = useCallback(async (assessmentId: string) => {
    if (creatingAssessmentId) return;

    const assessmentMeta = assessmentMetaById.get(assessmentId);
    const assessmentName = assessmentMeta?.name ?? assessmentId.replace(/_/g, ' ');
    const assessmentInstances = instancesByAssessmentId.get(assessmentId) ?? [];
    const engagedInstances = assessmentInstances.filter(isAssessmentUserEngaged);
    const completedInstance = engagedInstances.find((instance) => instance.is_plan_complete === true) ?? null;
    const existingInstance = completedInstance ?? engagedInstances[0] ?? null;

    if (existingInstance) {
      onOpenAssessment({
        instanceId: existingInstance.id,
        assessmentId: existingInstance.assessment_id,
        title: existingInstance.display_name || assessmentName,
      });
      return;
    }

    setCreatingAssessmentId(assessmentId);
    setError(null);
    try {
      const instance = await api.createAssessmentInstance(projectId, assessmentId);
      setInstances((previous) => [...previous, instance]);
      onOpenAssessment({
        instanceId: instance.id,
        assessmentId: instance.assessment_id,
        title: instance.display_name || assessmentName,
        pendingEngagement: true,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start assessment.');
    } finally {
      setCreatingAssessmentId(null);
    }
  }, [assessmentMetaById, creatingAssessmentId, instancesByAssessmentId, onOpenAssessment, projectId]);

  const handleLibrarySelect = useCallback((assessmentId: string) => {
    setLibraryOpen(false);
    setAssessmentSearchQuery('');
    void handleOpenAssessment(assessmentId);
  }, [handleOpenAssessment]);

  if (!loading && visibleRecommendedAssessmentIds.length === 0) {
    return null;
  }

  return (
    <section className="w-full overflow-visible pb-2 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3 pl-6 pr-6">
        <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Recommended Assessments
        </p>
        <div ref={libraryRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setLibraryOpen((open) => !open)}
            className="btn-secondary !px-3 !py-1.5 !text-xs"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Assessment Library
          </button>

          {libraryOpen ? (
            <div className="absolute right-0 top-full z-30 mt-2 w-[360px] max-h-[420px] overflow-y-auto rounded-xl border border-divider bg-white shadow-lg">
              <div className="sticky top-0 z-10 border-b border-divider bg-white px-4 pb-2 pt-3">
                <label htmlFor="recommended-assessment-library-search" className="sr-only">
                  Search assessments
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-divider bg-surface-subtle px-3 py-2">
                  <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" />
                  <input
                    id="recommended-assessment-library-search"
                    type="search"
                    value={assessmentSearchQuery}
                    onChange={(event) => setAssessmentSearchQuery(event.target.value)}
                    placeholder="Search assessments..."
                    className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-2">
                {filteredLibraryGroups.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-text-tertiary">
                    No assessments match your search.
                  </p>
                ) : filteredLibraryGroups.map((group) => (
                  <div key={group.id} className="mb-2 last:mb-0">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                      {group.name}
                    </p>
                    <div className="space-y-1">
                      {group.assessments.map((assessment) => {
                        const isCreating = creatingAssessmentId === assessment.id;
                        return (
                          <button
                            key={assessment.id}
                            type="button"
                            disabled={Boolean(creatingAssessmentId) && !isCreating}
                            onClick={() => handleLibrarySelect(assessment.id)}
                            className="w-full rounded-lg px-3 py-2 text-left transition-colors enabled:hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
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
                                  {assessment.description}
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
          ) : null}
        </div>
      </div>
      <div className="w-full space-y-4">
        {loading ? (
          <div className="flex justify-center rounded-2xl border border-stroke-subtle bg-white py-8">
            <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
          </div>
        ) : (
          groupedCategories.map((category) => (
            <section
              key={category.id}
              className="overflow-hidden rounded-2xl border border-stroke-subtle bg-white/70 p-4"
            >
              <div className="-mx-4 mb-4 border-b border-stroke-subtle px-4 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    {category.name}
                  </p>
                  <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[11px] font-medium text-text-tertiary">
                    {category.assessmentIds.length}
                    {' '}
                    {category.assessmentIds.length === 1 ? 'assessment' : 'assessments'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {category.assessmentIds.map((assessmentId) => {
                  const assessmentMeta = assessmentMetaById.get(assessmentId);
                  const assessmentName = assessmentMeta?.name ?? assessmentId.replace(/_/g, ' ');
                  const assessmentInstances = instancesByAssessmentId.get(assessmentId) ?? [];
                  const engagedInstances = assessmentInstances.filter(isAssessmentUserEngaged);
                  const completedInstance = engagedInstances.find(
                    (instance) => instance.is_plan_complete === true,
                  ) ?? null;
                  const isAssessmentComplete = Boolean(completedInstance);
                  const isCreating = creatingAssessmentId === assessmentId;

                  return (
                    <button
                      key={assessmentId}
                      type="button"
                      disabled={Boolean(creatingAssessmentId) && !isCreating}
                      onClick={() => {
                        void handleOpenAssessment(assessmentId);
                      }}
                      className={[
                        'group relative card-interactive overflow-visible text-left',
                        isAssessmentComplete
                          ? 'border border-stroke-subtle bg-accent-wash/35'
                          : 'border border-stroke-subtle bg-white',
                        'disabled:cursor-not-allowed disabled:opacity-60',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <div
                          className={[
                            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded',
                            isAssessmentComplete ? 'bg-accent text-white shadow-sm' : 'bg-accent-wash',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              '[&>svg]:h-5 [&>svg]:w-5',
                              isAssessmentComplete ? 'text-white' : 'text-accent',
                            ].join(' ')}
                          >
                            {isCreating ? (
                              <UniversalLoadingIcon size={18} colorClassName={isAssessmentComplete ? 'text-white' : 'text-accent'} />
                            ) : isAssessmentComplete ? (
                              <Check className="h-5 w-5" strokeWidth={2.4} />
                            ) : (
                              assessmentMeta?.icon
                            )}
                          </span>
                        </div>
                        <span className="min-w-0 flex-1">
                          <span
                            className={[
                              'block text-xs font-medium leading-snug',
                              isAssessmentComplete ? 'text-accent' : 'text-text-secondary',
                            ].join(' ')}
                          >
                            {assessmentName}
                          </span>
                          {assessmentMeta?.description ? (
                            <span className="mt-1 block text-[11px] leading-snug text-text-tertiary line-clamp-2">
                              {assessmentMeta.description}
                            </span>
                          ) : null}
                          {isAssessmentComplete ? (
                            <span className="mt-2 inline-flex h-[1.375rem] items-center justify-center rounded-full border border-accent/20 bg-white/75 px-2.5 text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-accent">
                              Confirmed
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
        {error ? (
          <p className="px-1 text-xs text-indicator-orange">{error}</p>
        ) : null}
      </div>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/AssessmentPicker';
import { ConfirmButton } from '@/components/ui';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useInitiativeStore } from '@/stores/initiativeStore';

interface AssessmentRecommendation {
  tool: {
    id: string;
    name: string;
    description: string;
    icon: string;
    output_type: string;
    category: string;
  };
  confidence: number;
  recommended: boolean;
}

interface AssessmentChecklistWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function AssessmentChecklistWidget({ data, initiativeId, isActive = true }: AssessmentChecklistWidgetProps) {
  const router = useRouter();
  const recommendations = useMemo(
    () => ((data?.recommendations || []) as AssessmentRecommendation[])
      .filter((recommendation) => recommendation?.tool?.id),
    [data],
  );
  const showBetaAssessments = useFeatureFlag('beta_assessments');
  const initiative = useInitiativeStore((s) => s.initiative);
  const selectTools = useInitiativeStore((s) => s.selectTools);
  const [confirmedLocal, setConfirmedLocal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessmentMetaById = useMemo(
    () => new Map(ALL_MODULES.map((assessment) => [assessment.id, assessment])),
    [],
  );

  const visibleRecommendations = useMemo(() => (
    recommendations.filter((recommendation) => {
      const assessmentMeta = assessmentMetaById.get(recommendation.tool.id);
      return showBetaAssessments || !assessmentMeta?.beta;
    })
  ), [showBetaAssessments, assessmentMetaById, recommendations]);

  const initialSelectedIds = useMemo(() => {
    const explicit = visibleRecommendations
      .filter((recommendation) => recommendation.recommended)
      .map((recommendation) => recommendation.tool.id);
    const fallback = visibleRecommendations.map((recommendation) => recommendation.tool.id);
    return explicit.length > 0 ? explicit : fallback;
  }, [visibleRecommendations]);
  const initialSelectedKey = initialSelectedIds.join('|');

  const [selectedAssessments, setSelectedAssessments] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );

  useEffect(() => {
    if (!confirmedLocal) {
      setSelectedAssessments(new Set(initialSelectedIds));
    }
  }, [confirmedLocal, initialSelectedIds, initialSelectedKey]);

  const selectedRecommendations = useMemo(
    () => visibleRecommendations.filter((recommendation) => selectedAssessments.has(recommendation.tool.id)),
    [selectedAssessments, visibleRecommendations],
  );

  const groupedRecommendations = useMemo(() => {
    const categoryByAssessmentId = new Map<string, { id: string; name: string }>();
    MODULE_CATEGORIES.forEach((category) => {
      category.assessmentIds.forEach((assessmentId) => {
        categoryByAssessmentId.set(assessmentId, { id: category.id, name: category.name });
      });
    });

    const grouped = MODULE_CATEGORIES.map((category) => ({
      id: category.id,
      name: category.name,
      items: selectedRecommendations.filter((recommendation) => category.assessmentIds.includes(recommendation.tool.id)),
    })).filter((category) => category.items.length > 0);

    const otherItems = selectedRecommendations.filter(
      (recommendation) => !categoryByAssessmentId.has(recommendation.tool.id),
    );

    if (otherItems.length > 0) {
      grouped.push({
        id: 'other',
        name: 'Other Assessments',
        items: otherItems,
      });
    }

    return grouped;
  }, [selectedRecommendations]);

  const title = 'Framework Plan';

  const confirmed =
    confirmedLocal ||
    Boolean(initiative?.selected_tools && initiative.selected_tools.length > 0);
  const canInteract = isActive && !confirmed && !submitting;

  if (!visibleRecommendations.length) {
    return <div className="text-sm text-text-tertiary">No assessments were recommended yet.</div>;
  }

  const handleToggleAssessment = (assessmentId: string) => {
    if (!canInteract) return;
    setSelectedAssessments((previous) => {
      const next = new Set(previous);
      if (next.has(assessmentId)) {
        next.delete(assessmentId);
      } else {
        next.add(assessmentId);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedAssessments.size === 0 || submitting) return;

    setConfirmedLocal(true);
    setSubmitting(true);
    setError(null);
    try {
      const selectedIds = visibleRecommendations
        .map((recommendation) => recommendation.tool.id)
        .filter((assessmentId) => selectedAssessments.has(assessmentId));
      await selectTools(initiativeId, selectedIds);
      const afterSelect = useInitiativeStore.getState();
      if (afterSelect.error) {
        throw new Error(afterSelect.error);
      }
      router.replace(`/initiatives/${initiativeId}?view=framework`);
    } catch (nextError) {
      setConfirmedLocal(false);
      setError(nextError instanceof Error ? nextError.message : 'Failed to confirm framework.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-elevated overflow-hidden">
      <div className="border-b border-divider bg-white px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          {title}
        </p>
      </div>

      <div className="space-y-5 bg-white px-5 py-5">
        {groupedRecommendations.map((category) => (
          <section key={category.id}>
            <p className="mb-3 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              {category.name}
            </p>
            <div className="space-y-3">
              {category.items.map((recommendation) => {
                const assessmentId = recommendation.tool.id;
                const assessmentMeta = assessmentMetaById.get(assessmentId);
                return (
                  <div
                    key={assessmentId}
                    className={`group relative overflow-hidden rounded-xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors ${
                      selectedAssessments.has(assessmentId) ? 'bg-accent-wash' : ''
                    } ${!canInteract ? 'opacity-80' : ''}`}
                  >
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-accent-wash text-accent [&>svg]:h-5 [&>svg]:w-5">
                        {assessmentMeta?.icon ?? <Check className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-text-primary">
                            {recommendation.tool.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => handleToggleAssessment(assessmentId)}
                            disabled={!canInteract}
                            aria-label={`Remove ${recommendation.tool.name}`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors enabled:hover:bg-white/60 enabled:hover:text-indicator-orange disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">
                          {recommendation.tool.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {error && (
          <p className="text-xs text-indicator-orange">{error}</p>
        )}
      </div>

      {(isActive || confirmed) && !confirmed && (
        <div className="border-t border-divider bg-white px-5 py-3">
          <div className="flex items-center justify-end">
            <ConfirmButton
              onClick={handleConfirm}
              disabled={!canInteract || selectedAssessments.size === 0}
              loading={submitting}
              label="Confirm"
              loadingLabel="Confirming..."
              size="sm"
              className="!px-4 !py-1.5 !text-xs"
            />
          </div>
        </div>
      )}

    </div>
  );
}

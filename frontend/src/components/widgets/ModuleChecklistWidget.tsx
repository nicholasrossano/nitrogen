'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { ConfirmButton } from '@/components/ui';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useInitiativeStore } from '@/stores/initiativeStore';

interface ModuleRecommendation {
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

interface ModuleChecklistWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function ModuleChecklistWidget({ data, initiativeId, isActive = true }: ModuleChecklistWidgetProps) {
  const router = useRouter();
  const recommendations = useMemo(
    () => ((data?.recommendations || []) as ModuleRecommendation[])
      .filter((recommendation) => recommendation?.tool?.id),
    [data],
  );
  const showBetaModules = useFeatureFlag('beta_modules');
  const initiative = useInitiativeStore((s) => s.initiative);
  const selectTools = useInitiativeStore((s) => s.selectTools);
  const [confirmedLocal, setConfirmedLocal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moduleMetaById = useMemo(
    () => new Map(ALL_MODULES.map((module) => [module.id, module])),
    [],
  );

  const visibleRecommendations = useMemo(() => (
    recommendations.filter((recommendation) => {
      const moduleMeta = moduleMetaById.get(recommendation.tool.id);
      return showBetaModules || !moduleMeta?.beta;
    })
  ), [showBetaModules, moduleMetaById, recommendations]);

  const initialSelectedIds = useMemo(() => {
    const explicit = visibleRecommendations
      .filter((recommendation) => recommendation.recommended)
      .map((recommendation) => recommendation.tool.id);
    const fallback = visibleRecommendations.map((recommendation) => recommendation.tool.id);
    return explicit.length > 0 ? explicit : fallback;
  }, [visibleRecommendations]);
  const initialSelectedKey = initialSelectedIds.join('|');

  const [selectedModules, setSelectedModules] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );

  useEffect(() => {
    if (!confirmedLocal) {
      setSelectedModules(new Set(initialSelectedIds));
    }
  }, [confirmedLocal, initialSelectedIds, initialSelectedKey]);

  const selectedRecommendations = useMemo(
    () => visibleRecommendations.filter((recommendation) => selectedModules.has(recommendation.tool.id)),
    [selectedModules, visibleRecommendations],
  );

  const groupedRecommendations = useMemo(() => {
    const categoryByModuleId = new Map<string, { id: string; name: string }>();
    MODULE_CATEGORIES.forEach((category) => {
      category.moduleIds.forEach((moduleId) => {
        categoryByModuleId.set(moduleId, { id: category.id, name: category.name });
      });
    });

    const grouped = MODULE_CATEGORIES.map((category) => ({
      id: category.id,
      name: category.name,
      items: selectedRecommendations.filter((recommendation) => category.moduleIds.includes(recommendation.tool.id)),
    })).filter((category) => category.items.length > 0);

    const otherItems = selectedRecommendations.filter(
      (recommendation) => !categoryByModuleId.has(recommendation.tool.id),
    );

    if (otherItems.length > 0) {
      grouped.push({
        id: 'other',
        name: 'Other Modules',
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
    return <div className="text-sm text-text-tertiary">No modules were recommended yet.</div>;
  }

  const handleToggleModule = (moduleId: string) => {
    if (!canInteract) return;
    setSelectedModules((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedModules.size === 0 || submitting) return;

    setConfirmedLocal(true);
    setSubmitting(true);
    setError(null);
    try {
      const selectedIds = visibleRecommendations
        .map((recommendation) => recommendation.tool.id)
        .filter((moduleId) => selectedModules.has(moduleId));
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
                const moduleId = recommendation.tool.id;
                const moduleMeta = moduleMetaById.get(moduleId);
                return (
                  <div
                    key={moduleId}
                    className={`group relative overflow-hidden rounded-xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors ${
                      selectedModules.has(moduleId) ? 'bg-accent-wash' : ''
                    } ${!canInteract ? 'opacity-80' : ''}`}
                  >
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-accent-wash text-accent [&>svg]:h-5 [&>svg]:w-5">
                        {moduleMeta?.icon ?? <Check className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-text-primary">
                            {recommendation.tool.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => handleToggleModule(moduleId)}
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
              disabled={!canInteract || selectedModules.size === 0}
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

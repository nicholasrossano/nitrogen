'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { useSettingsStore } from '@/stores/settingsStore';
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
  const recommendations = useMemo(
    () => ((data?.recommendations || []) as ModuleRecommendation[])
      .filter((recommendation) => recommendation?.tool?.id),
    [data],
  );
  const devMode = useSettingsStore((s) => s.devMode);
  const { selectTools, generateProjectPlan, projectPlan } = useInitiativeStore();
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
      return devMode || !moduleMeta?.beta;
    })
  ), [devMode, moduleMetaById, recommendations]);

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
      items: visibleRecommendations.filter((recommendation) => category.moduleIds.includes(recommendation.tool.id)),
    })).filter((category) => category.items.length > 0);

    const otherItems = visibleRecommendations.filter(
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
  }, [visibleRecommendations]);

  const title = String(data?.title || 'Recommended Framework Modules');
  const subtitle = String(
    data?.subtitle ||
      'Review the suggested modules for this project, remove any that do not fit, then confirm to set up the framework plan.',
  );
  const pendingTitle = String(data?.pendingTitle || 'Building your framework...');
  const pendingSubtitle = String(
    data?.pendingSubtitle ||
      `Setting up ${selectedModules.size} recommended module${selectedModules.size === 1 ? '' : 's'}`,
  );
  const successMessage = String(data?.successMessage || 'Framework generated. View it in the Framework tab.');
  const footerHint = String(data?.footerHint || 'Remove modules above or request changes in chat');
  const confirmLabel = String(data?.confirmLabel || 'Confirm Framework Modules');

  const confirmed = confirmedLocal || Boolean(projectPlan);
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
      await generateProjectPlan(initiativeId);
      const afterGenerate = useInitiativeStore.getState();
      if (afterGenerate.error || !afterGenerate.projectPlan) {
        throw new Error(afterGenerate.error || 'Failed to build framework.');
      }
    } catch (nextError) {
      setConfirmedLocal(false);
      setError(nextError instanceof Error ? nextError.message : 'Failed to build framework.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-elevated overflow-hidden">
      <div className="border-b border-divider px-5 py-4 bg-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          {confirmed ? pendingTitle : title}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
          {confirmed ? pendingSubtitle : subtitle}
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
                const isSelected = selectedModules.has(moduleId);

                return (
                  <div
                    key={moduleId}
                    className={`group relative overflow-hidden rounded-xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors ${
                      isSelected ? 'bg-accent-wash' : ''
                    } ${!canInteract ? 'opacity-80' : ''}`}
                  >
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-accent-wash text-accent [&>svg]:h-5 [&>svg]:w-5">
                        {moduleMeta?.icon ?? <Check className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-text-primary">
                            {recommendation.tool.name}
                          </p>
                          {recommendation.recommended && (
                            <span className="rounded-full bg-accent-wash px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">
                          {recommendation.tool.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-divider px-4 py-2.5">
                      <p className="text-[11px] text-text-tertiary">
                        {isSelected ? 'Included in the starting framework plan' : 'Not included yet'}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleToggleModule(moduleId)}
                        disabled={!canInteract}
                        className={`btn-secondary !px-2.5 !py-1 !text-[11px] ${
                          isSelected ? 'text-indicator-orange' : ''
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Include
                          </>
                        )}
                      </button>
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

      {(isActive || confirmed) && (
        <div className="border-t border-divider bg-surface-header px-5 py-3">
          {confirmed && !submitting ? (
            <p className="text-center text-xs text-text-tertiary">{successMessage}</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-text-tertiary">{footerHint}</p>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canInteract || selectedModules.size === 0}
                className="btn-primary !px-4 !py-1.5 !text-xs"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Building framework...
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    {confirmLabel}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

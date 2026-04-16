'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Map, Trash2 } from 'lucide-react';

import { PanelHeader } from '@/components/ui';
import type { PlanWorkspaceStructureConfirmData } from '@/components/plan-workspace';
import type { ProposedCategory } from '@/lib/api';
import { getIconByName } from '@/lib/icons';
import { useInitiativeStore } from '@/stores/initiativeStore';

import { runPlanStructureConfirmAction } from './planWidgetRegistry';

interface PlanStructureConfirmWidgetProps {
  data: PlanWorkspaceStructureConfirmData;
  initiativeId: string;
  isActive?: boolean;
}

export function PlanStructureConfirmWidget({
  data,
  initiativeId,
  isActive = true,
}: PlanStructureConfirmWidgetProps) {
  const { confirmPlanCategories, projectPlanLoading, projectPlan } = useInitiativeStore();
  const [localOptions, setLocalOptions] = useState(data.options);
  const [confirmedLocal, setConfirmedLocal] = useState(false);

  const confirmed = confirmedLocal || !!projectPlan;
  const isLoading = projectPlanLoading && confirmed;
  const canInteract = isActive && !confirmed;
  const canRemove = localOptions.length > data.minSelected;

  const selectedCategories = useMemo(
    () => localOptions.map((option) => ({
      id: option.id,
      name: option.name,
      summary: option.summary,
      icon: option.icon,
    })) satisfies ProposedCategory[],
    [localOptions],
  );

  if (!localOptions.length) {
    return (
      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
        No plan structure was proposed. Please try again.
      </div>
    );
  }

  const handleConfirm = async () => {
    setConfirmedLocal(true);
    await runPlanStructureConfirmAction(
      data.action.type,
      initiativeId,
      selectedCategories,
      { confirmPlanCategories },
    );
  };

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={Map}
        title={confirmed ? data.pendingTitle : data.title}
        subtitle={confirmed
          ? data.pendingSubtitleTemplate.replace('{count}', String(localOptions.length))
          : data.subtitle}
      />

      <div className="p-4 space-y-2 bg-white">
        {localOptions.map((option) => {
          const OptionIcon = getIconByName(option.icon);
          return (
            <div
              key={option.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-stroke-subtle bg-white group"
            >
              <div className="w-7 h-7 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <OptionIcon className="w-3.5 h-3.5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{option.name}</p>
                <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{option.summary}</p>
              </div>
              {canInteract && canRemove && (
                <button
                  onClick={() => setLocalOptions((prev) => prev.filter((candidate) => candidate.id !== option.id))}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-subtle flex-shrink-0"
                  title="Remove option"
                >
                  <Trash2 className="w-3.5 h-3.5 text-text-tertiary hover:text-indicator-orange transition-colors" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {(canInteract || isLoading) && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
          <p className="text-[10px] text-text-tertiary">{data.footerHint}</p>
          <button
            onClick={handleConfirm}
            disabled={isLoading || localOptions.length < data.minSelected}
            className="btn-primary !text-xs !px-4 !py-1.5"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating plan...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                {data.confirmLabel}
              </>
            )}
          </button>
        </div>
      )}

      {confirmed && !isLoading && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider">
          <p className="text-xs text-text-tertiary text-center">{data.successMessage}</p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Check, Loader2, Map, Trash2 } from 'lucide-react';
import { PanelHeader } from '@/components/ui';
import { getIconByName } from '@/lib/icons';
import type { ProposedCategory } from '@/lib/api';

interface PlanCategoriesWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function PlanCategoriesWidget({ data, initiativeId, isActive = true }: PlanCategoriesWidgetProps) {
  const { confirmPlanCategories, projectPlanLoading, projectPlan } = useInitiativeStore();

  const categories = (data?.categories || []) as ProposedCategory[];
  const [localCategories, setLocalCategories] = useState<ProposedCategory[]>(categories);
  const [confirmedLocal, setConfirmedLocal] = useState(false);

  // Treat as confirmed if the plan already exists (survives page refresh)
  const confirmed = confirmedLocal || !!projectPlan;

  if (!categories.length) {
    return (
      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
        No categories were proposed. Please try again.
      </div>
    );
  }

  const handleRemove = (id: string) => {
    if (localCategories.length <= 2) return;
    setLocalCategories(prev => prev.filter(c => c.id !== id));
  };

  const handleConfirm = async () => {
    setConfirmedLocal(true);
    await confirmPlanCategories(initiativeId, localCategories);
  };

  const isLoading = projectPlanLoading && confirmed;
  const canInteract = isActive && !confirmed;

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={Map}
        title={confirmed ? 'Building your project plan...' : 'Proposed Plan Structure'}
        subtitle={confirmed
          ? `Generating detailed breakdown for ${localCategories.length} categories`
          : `Proposing the following ${localCategories.length} categories. Review and confirm to generate the full breakdown, or propose changes in the chat.`}
      />

      {/* Category list */}
      <div className="p-4 space-y-2 bg-white">
        {localCategories.map((category) => {
          const CategoryIcon = getIconByName(category.icon);
          return (
            <div
              key={category.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-stroke-subtle bg-white group"
            >
              <div className="w-7 h-7 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <CategoryIcon className="w-3.5 h-3.5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{category.name}</p>
                <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{category.summary}</p>
              </div>
              {canInteract && localCategories.length > 2 && (
                <button
                  onClick={() => handleRemove(category.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-subtle flex-shrink-0"
                  title="Remove category"
                >
                  <Trash2 className="w-3.5 h-3.5 text-text-tertiary hover:text-indicator-orange transition-colors" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {(canInteract || isLoading) && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
          <p className="text-[10px] text-text-tertiary">
            Remove categories above &middot; Request changes via the chat
          </p>
          <button
            onClick={handleConfirm}
            disabled={isLoading || localCategories.length < 2}
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
                Confirm &amp; Generate Plan
              </>
            )}
          </button>
        </div>
      )}

      {/* Post-confirm static footer */}
      {confirmed && !isLoading && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider">
          <p className="text-xs text-text-tertiary text-center">
            Plan generated. View it in the Project Plan tab.
          </p>
        </div>
      )}
    </div>
  );
}

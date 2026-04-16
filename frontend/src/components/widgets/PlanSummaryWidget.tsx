'use client';

import { CheckCircle2, Circle, LayoutGrid } from 'lucide-react';

import type { PlanWorkspaceSummaryData } from '@/components/plan-workspace';
import { PanelHeader } from '@/components/ui';
import { getIconByName } from '@/lib/icons';

interface PlanSummaryWidgetProps {
  data: PlanWorkspaceSummaryData;
}

export function PlanSummaryWidget({ data }: PlanSummaryWidgetProps) {
  const subtitle = data.subtitle ?? (
    <>
      {data.totalItems} deliverables identified across {data.groups.length} pillars
      {(data.requiredCount ?? 0) > 0 && <> &middot; {data.requiredCount} required</>}
    </>
  );

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader icon={LayoutGrid} title={data.title} subtitle={subtitle} />

      <div className="p-4 space-y-2 bg-white">
        {data.groups.map((group) => {
          const Icon = group.icon ? getIconByName(group.icon) : Circle;
          return (
            <div
              key={group.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-stroke-subtle bg-white"
            >
              <div className="w-7 h-7 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Icon className="w-3.5 h-3.5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{group.name}</p>
                <p className="text-xs text-text-tertiary">
                  {group.itemCount} items
                  {(group.requiredCount ?? 0) > 0 && <> &middot; {group.requiredCount} required</>}
                </p>
              </div>
              <CheckCircle2 className="w-4 h-4 text-indicator-green flex-shrink-0" />
            </div>
          );
        })}
      </div>

      {data.footerText && (
        <div className="px-5 py-3 bg-surface-header border-t border-divider">
          <p className="text-xs text-text-tertiary text-center">{data.footerText}</p>
        </div>
      )}
    </div>
  );
}

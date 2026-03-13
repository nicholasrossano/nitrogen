'use client';

import { Shield, DollarSign, Compass, CheckCircle2, Circle, LayoutGrid } from 'lucide-react';
import { PanelHeader } from '@/components/ui';

interface PillarSummary {
  id: string;
  name: string;
  item_count: number;
}

interface ProjectPlanWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

const PILLAR_ICONS: Record<string, typeof Shield> = {
  authorization: Shield,
  capital: DollarSign,
  design: Compass,
};

const PILLAR_NAMES: Record<string, string> = {
  authorization: 'Authorization',
  capital: 'Capital',
  design: 'Design',
};

export function ProjectPlanWidget({ data }: ProjectPlanWidgetProps) {
  const summary = data?.summary as { total_items: number; pillars: PillarSummary[] } | undefined;
  const plan = data?.plan as { pillars: any[] } | undefined;

  if (!summary || !plan) return null;

  const requiredCount = plan.pillars.reduce(
    (acc, p) => acc + (p.items?.filter((i: any) => i.classification === 'required').length ?? 0),
    0,
  );

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={LayoutGrid}
        title="Project Plan"
        subtitle={<>{summary.total_items} deliverables identified across {summary.pillars.length} pillars{requiredCount > 0 && <> &middot; {requiredCount} required</>}</>}
      />

      <div className="p-4 space-y-2 bg-white">
        {summary.pillars.map((pillar) => {
          const Icon = PILLAR_ICONS[pillar.id] ?? Circle;
          const pillarData = plan.pillars.find((p: any) => p.id === pillar.id);
          const reqCount = pillarData?.items?.filter((i: any) => i.classification === 'required').length ?? 0;

          return (
            <div
              key={pillar.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-stroke-subtle bg-white"
            >
              <div className="w-7 h-7 rounded bg-accent-wash flex items-center justify-center flex-shrink-0">
                <Icon className="w-3.5 h-3.5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{PILLAR_NAMES[pillar.id] ?? pillar.name}</p>
                <p className="text-xs text-text-tertiary">
                  {pillar.item_count} items{reqCount > 0 && <> &middot; {reqCount} required</>}
                </p>
              </div>
              <CheckCircle2 className="w-4 h-4 text-indicator-green flex-shrink-0" />
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 bg-surface-header border-t border-divider">
        <p className="text-xs text-text-tertiary text-center">
           You can edit this as needed in the diagram directly.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Shield, Banknote, Compass, ChevronDown } from 'lucide-react';
import { ProjectPlanPillar } from '@/lib/api';
import { PlanSubItem } from './PlanSubItem';

interface PillarColumnProps {
  pillar: ProjectPlanPillar;
}

const PILLAR_ICONS: Record<string, React.ReactNode> = {
  authorization: <Shield className="w-5 h-5" />,
  capital: <Banknote className="w-5 h-5" />,
  design: <Compass className="w-5 h-5" />,
};

const PILLAR_NAMES: Record<string, string> = {
  authorization: 'Authorization',
  capital: 'Capital',
  design: 'Design',
};

const DEFAULT_VISIBLE = 10;

export function PillarColumn({ pillar }: PillarColumnProps) {
  const [showAll, setShowAll] = useState(false);
  const items = pillar.items || [];
  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = items.length - DEFAULT_VISIBLE;
  const requiredCount = items.filter(i => i.classification === 'required').length;
  const unknownCount = items.filter(i => i.classification === 'unknown').length;
  const optionalCount = items.length - requiredCount - unknownCount;

  return (
    <div className="flex flex-col min-h-0">
      {/* Pillar header node — full width, aligned with items */}
      <div className="border border-accent bg-accent-wash/30 px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-accent/10 rounded flex items-center justify-center text-accent flex-shrink-0">
          {PILLAR_ICONS[pillar.id] || <Compass className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary leading-tight">
            {PILLAR_NAMES[pillar.id] ?? pillar.name}
          </h3>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {requiredCount} required &middot; {optionalCount} optional
            {unknownCount > 0 && <> &middot; <span className="text-indicator-orange">{unknownCount} unknown</span></>}
          </p>
        </div>
      </div>

      {/* Items — branch line connects from header's left edge */}
      <div className="flex-1 overflow-y-auto">
        {visibleItems.map((item, idx) => (
          <PlanSubItem
            key={item.id}
            item={item}
            isLast={idx === visibleItems.length - 1 && (showAll || hiddenCount <= 0)}
          />
        ))}

        {!showAll && hiddenCount > 0 && (
          <div className="flex items-stretch">
            <div className="w-8 flex flex-col items-center flex-shrink-0">
              <div className="w-px bg-stroke-subtle flex-1" />
            </div>
            <div className="flex-1 py-1.5 pl-2">
              <button
                onClick={() => setShowAll(true)}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1"
              >
                <ChevronDown className="w-3 h-3" />
                {hiddenCount} more
              </button>
            </div>
          </div>
        )}
        {showAll && hiddenCount > 0 && (
          <div className="flex items-stretch">
            <div className="w-8 flex-shrink-0" />
            <div className="flex-1 py-1.5 pl-2">
              <button
                onClick={() => setShowAll(false)}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Show less
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

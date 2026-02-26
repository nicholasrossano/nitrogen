'use client';

import { ProjectPlanItem } from '@/lib/api';

interface PlanSubItemProps {
  item: ProjectPlanItem;
  isLast: boolean;
}

export function PlanSubItem({ item, isLast }: PlanSubItemProps) {
  const isRequired = item.classification === 'required';

  return (
    <div className="flex items-stretch">
      {/* Branch gutter — dot centered on the vertical line */}
      <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
        <div className="w-px bg-stroke-subtle flex-1" />
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isRequired ? 'bg-accent' : 'bg-stroke-subtle'
          }`}
        />
        {!isLast ? <div className="w-px bg-stroke-subtle flex-1" /> : <div className="flex-1" />}
        {/* Horizontal arm from dot's right edge to gutter edge */}
        <div className="absolute top-1/2 right-0 w-[calc(50%-4px)] h-px bg-stroke-subtle -translate-y-[0.5px]" />
      </div>

      {/* Node card */}
      <div className="flex-1 min-w-0 py-1.5 pr-0">
        <div
          className={`px-3 py-2.5 border transition-colors ${
            isRequired
              ? 'border-accent/30 bg-accent-wash/20'
              : 'border-stroke-subtle bg-white'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary leading-snug flex-1 min-w-0">
              {item.title}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-sm font-semibold uppercase tracking-wide leading-none flex-shrink-0 ${
                isRequired
                  ? 'bg-accent/10 text-accent'
                  : 'bg-surface-subtle text-text-tertiary'
              }`}
            >
              {isRequired ? 'Req' : 'Opt'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

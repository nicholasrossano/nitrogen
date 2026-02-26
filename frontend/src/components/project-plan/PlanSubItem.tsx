'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem } from '@/lib/api';

interface PlanSubItemProps {
  item: ProjectPlanItem;
  isLast: boolean;
  deepDiveResult?: DeepDiveResult | null;
  onDeepDive?: (item: ProjectPlanItem) => void;
}

type Classification = 'required' | 'optional' | 'unknown';

const CLASSIFICATION_STYLES: Record<Classification, {
  dot: string;
  card: string;
  badge: string;
  label: string;
}> = {
  required: {
    dot: 'bg-accent',
    card: 'border-accent/30 bg-accent-wash/20',
    badge: 'bg-accent/10 text-accent',
    label: 'REQ',
  },
  optional: {
    dot: 'bg-accent',
    card: 'border-stroke-subtle bg-white',
    badge: 'bg-surface-subtle text-text-tertiary',
    label: 'OPT',
  },
  unknown: {
    dot: 'bg-accent',
    card: 'border-indicator-orange/20 bg-indicator-orange/5',
    badge: 'bg-indicator-orange/10 text-indicator-orange',
    label: 'UNK',
  },
};

const ELEMENT_STYLE = {
  dot: 'bg-accent',
  card: 'border-stroke-subtle bg-white',
};

export function PlanSubItem({ item, isLast, deepDiveResult, onDeepDive }: PlanSubItemProps) {
  const [elementsExpanded, setElementsExpanded] = useState(false);
  const cls = (item.classification as Classification) ?? 'optional';
  const styles = CLASSIFICATION_STYLES[cls] ?? CLASSIFICATION_STYLES.optional;
  const isClickable = Boolean(onDeepDive);

  const elements = deepDiveResult?.elements ?? [];
  const hasElements = Boolean(deepDiveResult) && elements.length > 0;
  const showElements = hasElements && elementsExpanded;

  return (
    <>
      {/* Main item row */}
      <div className="flex items-stretch relative">
        {/* Branch gutter */}
        <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
          <div className="w-px bg-stroke-subtle flex-1" />
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
          {(!isLast || showElements)
            ? <div className="w-px bg-stroke-subtle flex-1" />
            : <div className="flex-1" />}
          <div className="absolute top-1/2 right-0 w-[calc(50%-4px)] h-px bg-stroke-subtle -translate-y-[0.5px]" />
        </div>

        {/* Bridges the pb-1.5 gap so Col B's line touches the card bottom */}
        {showElements && <div className="absolute bottom-0 left-11 w-px h-1.5 bg-stroke-subtle" />}

        {/* Node card */}
        <div className="flex-1 min-w-0 py-1.5 pr-0">
          <div
            className={`px-3 py-2.5 border ${styles.card} ${isClickable ? 'plan-item-lift cursor-pointer' : ''} relative`}
            onClick={isClickable ? () => onDeepDive!(item) : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDeepDive!(item); } } : undefined}
            aria-label={isClickable ? `Deep dive: ${item.title}` : undefined}
          >
            <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-sm font-semibold uppercase tracking-wide leading-none ${styles.badge}`}>
              {styles.label}
            </span>
            <span className="text-sm font-medium text-text-primary leading-snug block pr-10">
              {item.title}
            </span>
            {hasElements && (
              <button
                onClick={(e) => { e.stopPropagation(); setElementsExpanded(!elementsExpanded); }}
                className="absolute bottom-2 right-2 w-4 h-4 flex items-center justify-center text-text-tertiary hover:text-text-secondary transition-colors"
                aria-label={elementsExpanded ? 'Collapse elements' : 'Expand elements'}
              >
                {elementsExpanded
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Element sub-nodes — third layer */}
      {showElements && elements.map((el, i) => {
        const isLastEl = i === elements.length - 1;
        const elStyles = ELEMENT_STYLE;

        return (
          <div key={i} className="flex items-stretch">
            {/* Col A: parent branch continuation + L-bend to Col B */}
            <div className="w-8 flex-shrink-0 flex items-center justify-center relative">
              {(!isLast || !isLastEl)
                ? <div className="w-px bg-stroke-subtle h-full" />
                : <div className="w-px bg-stroke-subtle h-1/2 self-start" />}
              <div className="absolute top-1/2 left-1/2 right-0 h-px bg-stroke-subtle -translate-y-[0.5px]" />
            </div>

            {/* Col B: element sub-branch gutter */}
            <div className="w-6 flex flex-col items-center flex-shrink-0 relative">
              <div className="w-px bg-stroke-subtle flex-1" />
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 relative z-10 ${elStyles.dot}`} />
              {!isLastEl
                ? <div className="w-px bg-stroke-subtle flex-1" />
                : <div className="flex-1" />}
              <div className="absolute top-1/2 left-0 right-0 h-px bg-stroke-subtle -translate-y-[0.5px]" />
            </div>

            {/* Col C: element card */}
            <div className="flex-1 min-w-0 py-1 pr-0">
              <div className={`px-2.5 py-2 border ${elStyles.card}`}>
                <span className="text-xs font-medium text-text-primary leading-snug">
                  {el.title}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Minus } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem } from '@/lib/api';

interface PlanSubItemProps {
  item: ProjectPlanItem;
  isLast: boolean;
  deepDiveResult?: DeepDiveResult | null;
  onDeepDive?: (item: ProjectPlanItem) => void;
  onDelete?: () => void;
  onDeleteElement?: (elementIndex: number) => void;
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
    card: 'border-stroke-subtle bg-white',
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
    card: 'border-stroke-subtle bg-white',
    badge: 'bg-indicator-orange/10 text-indicator-orange',
    label: 'UNK',
  },
};

const ELEMENT_STYLE = {
  dot: 'bg-accent',
  card: 'border-stroke-subtle bg-white',
};

export function PlanSubItem({ item, isLast, deepDiveResult, onDeepDive, onDelete, onDeleteElement }: PlanSubItemProps) {
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
      <div className="flex items-stretch relative group/item">
        {/* Branch gutter */}
        <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
          <div className="w-px bg-stroke-subtle flex-1" />
          <div className="relative flex-shrink-0 w-2 h-2">
            <div className={`w-2 h-2 rounded-full transition-opacity duration-200 ease-in-out ${onDelete ? 'group-hover/item:opacity-0' : ''} ${styles.dot}`} />
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 opacity-0 scale-50 group-hover/item:opacity-100 group-hover/item:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out z-20"
                aria-label="Delete item"
              >
                <Minus className="w-2.5 h-2.5 text-white" />
              </button>
            )}
          </div>
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
          <div key={i} className="flex items-stretch group/element">
            {/* Col A: parent branch continuation only, no horizontal connector */}
            <div className="w-8 flex-shrink-0 flex items-center justify-center relative">
              {(!isLast || !isLastEl)
                ? <div className="w-px bg-stroke-subtle h-full" />
                : <div className="w-px bg-stroke-subtle h-1/2 self-start" />}
            </div>

            {/* Col B: element sub-branch gutter */}
            <div className="w-6 flex flex-col items-center flex-shrink-0 relative">
              <div className="w-px bg-stroke-subtle flex-1" />
              <div className="relative flex-shrink-0 w-1.5 h-1.5 z-10">
                <div className={`w-1.5 h-1.5 rounded-full transition-opacity duration-200 ease-in-out ${onDeleteElement ? 'group-hover/element:opacity-0' : ''} ${elStyles.dot}`} />
                {onDeleteElement && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteElement(i); }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-0 scale-50 group-hover/element:opacity-100 group-hover/element:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out z-20"
                    aria-label="Delete element"
                  >
                    <Minus className="w-2 h-2 text-white" />
                  </button>
                )}
              </div>
              {!isLastEl
                ? <div className="w-px bg-stroke-subtle flex-1" />
                : <div className="flex-1" />}
              <div className="absolute top-1/2 left-1/2 right-0 h-px bg-stroke-subtle -translate-y-[0.5px]" />
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

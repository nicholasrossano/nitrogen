'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BuildItem } from '@/lib/api';
import { ModuleItem } from '../ModuleItem';
import { coerceDisplayString } from '../renderUtils';

const STANCE_STYLES: Record<string, string> = {
  supportive: 'text-green-400',
  neutral:    'text-yellow-400',
  opposed:    'text-red-400',
  unknown:    'text-text-tertiary',
};

interface DetailNodeViewProps {
  items: BuildItem[];
  onConfirm?: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onAddToChat?: (item: BuildItem) => void;
}

function DetailCard({ item, onDelete, onAddToChat }: {
  item: BuildItem;
  onDelete: () => void;
  onAddToChat?: (item: BuildItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const c = item.content;
  const name = coerceDisplayString(c.name ?? c.title) || 'Item';
  const stance = c.support_stance;
  const stanceClass = stance ? (STANCE_STYLES[stance] ?? STANCE_STYLES.unknown) : '';

  const detailFields: Array<{ key: string; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'interests', label: 'Interests' },
    { key: 'concerns', label: 'Concerns' },
    { key: 'engagement_strategy', label: 'Engagement Strategy' },
    { key: 'strategic_relevance', label: 'Strategic Relevance' },
    { key: 'potential_linkages', label: 'Linkages' },
    { key: 'key_activities', label: 'Key Activities' },
    { key: 'geographic_focus', label: 'Geography' },
  ];

  return (
    <ModuleItem
      item={item}
      onDelete={onDelete}
      onAddToChat={onAddToChat}
      className="items-start"
    >
      <div className="w-full">
        <button
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-text-tertiary">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          <span className="text-sm font-medium text-text-primary">{name}</span>
          {c.influence_level && (
            <span className="text-xs text-text-tertiary">({c.influence_level} influence)</span>
          )}
          {stance && (
            <span className={`text-xs font-medium ${stanceClass}`}>{stance}</span>
          )}
        </button>

        {expanded && (
          <div className="mt-2 ml-5 space-y-2.5">
            {detailFields.map(({ key, label }) => {
              const val = c[key];
              if (!val) return null;
              if (Array.isArray(val)) {
                return (
                  <div key={key}>
                    <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">{label}</p>
                    <ul className="space-y-0.5">
                      {val.map((v, i) => (
                        <li key={i} className="text-xs text-text-secondary flex gap-1.5">
                          <span className="text-text-tertiary mt-0.5">•</span>
                          <span>{coerceDisplayString(v)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }
              return (
                <div key={key}>
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{coerceDisplayString(val)}</p>
                </div>
              );
            })}

            {Array.isArray(c.data_sources) && c.data_sources.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Sources</p>
                <ul className="space-y-0.5">
                  {(c.data_sources as unknown[]).map((s, i) => (
                    <li key={i} className="text-xs text-text-tertiary">{coerceDisplayString(s)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </ModuleItem>
  );
}

export function DetailNodeView({ items, onDelete, onAddToChat }: DetailNodeViewProps) {
  if (items.length === 0) {
    return <div className="py-8 text-center text-sm text-text-tertiary">No items yet.</div>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <DetailCard
          key={item.id}
          item={item}
          onDelete={() => onDelete(item.id)}
          onAddToChat={onAddToChat}
        />
      ))}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { BookOpen, MessageSquarePlus, Trash2 } from 'lucide-react';
import type { BuildItem } from '@/lib/api';
import { coerceDisplayString } from './renderUtils';

interface ItemToolbarProps {
  item: BuildItem;
  onDelete?: () => void;
  onAddToChat?: (item: BuildItem) => void;
}

export function ItemToolbar({ item, onDelete, onAddToChat }: ItemToolbarProps) {
  const [showSources, setShowSources] = useState(false);
  const hasSources = (item.provenance?.sources?.length ?? 0) > 0;

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Sources popover */}
      {hasSources && (
        <div className="relative">
          <button
            className="p-1 rounded hover:bg-surface-subtle text-text-tertiary hover:text-text-secondary transition-colors"
            onClick={() => setShowSources(!showSources)}
            title="View sources"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          {showSources && (
            <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-surface border border-stroke-subtle rounded-lg shadow-lg p-3">
              <p className="text-xs font-medium text-text-secondary mb-2">Sources</p>
              {item.provenance.sources.map((src, idx) => (
                <div key={idx} className="mb-2 last:mb-0">
                  <p className="text-xs text-text-primary truncate">{coerceDisplayString(src.source_title)}</p>
                  {src.excerpt != null && String(coerceDisplayString(src.excerpt)) !== '' && (
                    <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">
                      {coerceDisplayString(src.excerpt)}
                    </p>
                  )}
                </div>
              ))}
              {item.provenance.rationale && (
                <>
                  <div className="border-t border-stroke-subtle my-2" />
                  <p className="text-[11px] text-text-tertiary">{item.provenance.rationale}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add to chat */}
      {onAddToChat && (
        <button
          className="p-1 rounded hover:bg-surface-subtle text-text-tertiary hover:text-text-secondary transition-colors"
          onClick={() => onAddToChat(item)}
          title="Add to chat"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Delete */}
      {item.removable && onDelete && (
        <button
          className="p-1 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-400 transition-colors"
          onClick={onDelete}
          title="Remove item"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

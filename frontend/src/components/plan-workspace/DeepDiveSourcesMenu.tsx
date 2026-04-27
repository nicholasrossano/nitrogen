'use client';

import { useEffect, useRef, useState } from 'react';
import { BookMarked, FileText, Globe } from 'lucide-react';

import type {
  PlanWorkspaceInspectorCitationSource,
  PlanWorkspaceInspectorDocumentSource,
} from './types';

interface DeepDiveSourcesMenuProps {
  sources: PlanWorkspaceInspectorCitationSource[];
  onOpenDocument?: (source: PlanWorkspaceInspectorDocumentSource) => void;
}

function sourceIcon(type: PlanWorkspaceInspectorCitationSource['type']) {
  if (type === 'document') return <FileText className="h-3 w-3 shrink-0" />;
  return <Globe className="h-3 w-3 shrink-0" />;
}

function sourceLabel(type: PlanWorkspaceInspectorCitationSource['type']) {
  return type === 'document' ? 'Uploaded' : 'Web';
}

export function DeepDiveSourcesMenu({ sources, onOpenDocument }: DeepDiveSourcesMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasSources = sources.length > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!hasSources) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        title="Sources"
        aria-label="Sources"
        onClick={() => setOpen((value) => !value)}
        className={[
          'flex items-center gap-1 rounded py-0.5 pl-1.5 pr-2 text-[11px] transition-colors',
          open ? 'bg-accent/[0.07] text-accent' : 'text-text-tertiary hover:text-text-primary',
        ].join(' ')}
      >
        <BookMarked className="h-3.5 w-3.5" />
        <span>Sources</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[240px] max-w-[340px] rounded-lg border border-stroke-subtle bg-white p-2 shadow-lg">
          <div className="space-y-0.5">
            {sources.map((source) => (
              <div
                key={source.key}
                className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-subtle"
              >
                <span className="shrink-0 text-[10px] font-medium text-text-tertiary">
                  [{source.citationNumber}]
                </span>
                <span className="shrink-0 text-text-tertiary">{sourceIcon(source.type)}</span>
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-text-tertiary">
                  {sourceLabel(source.type)}
                </span>
                {source.type === 'document' && onOpenDocument ? (
                  <button
                    type="button"
                    className="truncate text-left text-xs text-accent hover:underline"
                    onClick={() => {
                      onOpenDocument(source);
                      setOpen(false);
                    }}
                  >
                    {source.label}
                  </button>
                ) : source.type === 'link' && source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-xs text-accent hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    {source.label}
                  </a>
                ) : (
                  <span className="truncate text-xs text-text-secondary">{source.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

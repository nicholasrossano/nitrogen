'use client';

import { useEffect, useState } from 'react';
import { X, Clock, User } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/ModulePicker';
import { api, type ModuleInstance } from '@/lib/api';
import { ModalShell } from '@/components/ui/ModalShell';

const MODULE_MAP = new Map(ALL_MODULES.map((m) => [m.id, m]));

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  started: { label: 'Started', bg: 'bg-zinc-100', text: 'text-zinc-500' },
  alignment_proposed: { label: 'Outline Proposed', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  alignment_confirmed: { label: 'Outline Confirmed', bg: 'bg-blue-50', text: 'text-blue-700' },
  generating: { label: 'Generating', bg: 'bg-purple-50', text: 'text-purple-700' },
  complete: { label: 'Complete', bg: 'bg-green-50', text: 'text-green-700' },
  error: { label: 'Error', bg: 'bg-red-50', text: 'text-red-700' },
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatEmail(email: string | null, fallback: string): string {
  if (email) return email;
  // Show a readable truncation of the UID if no email resolved
  return fallback.length > 16 ? `${fallback.slice(0, 8)}…` : fallback;
}

interface OpenModuleModalProps {
  initiativeId: string;
  onSelect: (instance: ModuleInstance) => void;
  onClose: () => void;
}

export function OpenModuleModal({ initiativeId, onSelect, onClose }: OpenModuleModalProps) {
  const [instances, setInstances] = useState<ModuleInstance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.listModuleInstances(initiativeId);
        if (!cancelled) setInstances(data);
      } catch {
        if (!cancelled) setInstances([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initiativeId]);

  // Add instance numbering for duplicate tool_ids
  const enriched = instances.map((inst) => {
    const sameToolInstances = instances.filter((i) => i.tool_id === inst.tool_id);
    const hasDuplicates = sameToolInstances.length > 1;
    const index = hasDuplicates
      ? [...sameToolInstances]
          .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
          .findIndex((i) => i.id === inst.id) + 1
      : null;
    return { ...inst, index };
  });

  const content = (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stroke-subtle">
          <h2 className="text-sm font-semibold text-text-primary">Open Module</h2>
          <button
            onClick={onClose}
            className="p-1.5 shrink-0 rounded-md text-text-tertiary enabled:hover:text-text-primary enabled:hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[62vh] overflow-y-auto">
          <p className="text-sm text-text-tertiary mb-6">
            Pick up where you or a collaborator left off in any module started in this project.
          </p>
          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[88px] rounded-lg bg-surface-subtle animate-pulse" />
              ))}
            </div>
          ) : enriched.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-text-secondary">No modules started yet.</p>
              <p className="text-xs text-text-tertiary mt-1">Use &quot;New Module&quot; to begin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {enriched.map((inst) => {
                const mod = MODULE_MAP.get(inst.tool_id);
                const displayName = mod
                  ? inst.index ? `${mod.name} #${inst.index}` : mod.name
                  : inst.index
                    ? `${inst.tool_id.replace(/_/g, ' ')} #${inst.index}`
                    : inst.tool_id.replace(/_/g, ' ');
                const status = STATUS_LABELS[inst.status] ?? STATUS_LABELS.started;
                const authorLabel = formatEmail(inst.started_by_email, inst.started_by);

                return (
                  <button
                    key={inst.id}
                    onClick={() => onSelect(inst)}
                    className="card-interactive border border-black/[0.04] relative flex items-start gap-3 px-4 py-3.5 text-left"
                  >
                    {/* Status pill — top right, confidence-tag style */}
                    <span className={`absolute top-2.5 right-2.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${status.bg} ${status.text}`}>
                      {status.label}
                    </span>

                    {/* Module icon */}
                    <div className="w-10 h-10 flex-shrink-0 rounded flex items-center justify-center bg-accent-wash [&>svg]:w-5 [&>svg]:h-5 text-accent">
                      {mod?.icon}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1 pt-0.5 pr-20">
                      <p className="text-xs font-medium text-text-secondary leading-snug truncate">
                        {displayName}
                      </p>

                      {/* Meta row */}
                      <div className="mt-2 flex items-center gap-2.5 text-[11px] text-text-tertiary">
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(inst.updated_at)}
                        </span>
                        <span className="flex items-center gap-0.5 min-w-0">
                          <User className="w-3 h-3 shrink-0" />
                          <span className="truncate">{authorLabel}</span>
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
    </ModalShell>
  );

  return content;
}

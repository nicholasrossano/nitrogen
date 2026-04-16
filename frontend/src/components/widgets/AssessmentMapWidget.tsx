'use client';

/**
 * AssessmentMapWidget
 *
 * Renders the "Map" stage for Landscape Mapping and Stakeholder Assessment modules.
 * Shows confirmed categories as pillar columns and entities/stakeholders as node cards,
 * reusing PlanStructureColumn for visual consistency with the plan workspace.
 *
 * On item click: opens an inspector panel showing the item's details + provenance.
 * Export buttons: "Write-up" (cached LLM DOCX) and "Decision Log" (deterministic DOCX).
 */

import { useState, useCallback } from 'react';
import {
  Download, X, ExternalLink, Loader2, FileText, ClipboardList,
  ChevronRight,
} from 'lucide-react';
import { getIconByName } from '@/lib/icons';
import { PlanStructureColumn } from '@/components/plan-workspace/PlanStructureColumn';
import type { PlanWorkspaceGroup, PlanWorkspaceItem } from '@/components/plan-workspace/types';
import type { WorkspaceWidgetProps } from '@/lib/widgetRegistry';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssessmentItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  influence_level?: string;
  impact_level?: string;
  engagement_priority?: string;
  role_in_project?: string;
  provenance?: {
    derivation?: string;
    sources?: Array<{ title?: string; url?: string }>;
    user_email?: string;
  };
}

interface AssessmentGroup {
  id: string;
  label: string;
  icon?: string;
  color: string;
  items: AssessmentItem[];
}

interface AssessmentMapData {
  groups: AssessmentGroup[];
  module_id?: string;
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

interface InspectorPanelProps {
  item: AssessmentItem;
  groupLabel: string;
  groupColor: string;
  onClose: () => void;
}

function sourceLabel(provenance?: AssessmentItem['provenance']): { type: string; detail: string } {
  if (!provenance) return { type: 'model', detail: 'Model (training data)' };
  const derivation = (provenance.derivation || '').toLowerCase();
  const isUser = derivation.includes('user');
  if (isUser) {
    const email = provenance.user_email;
    return { type: 'user', detail: email ? `Added by ${email}` : 'Added by user' };
  }
  const sources = provenance.sources || [];
  if (sources.length > 0) {
    const cited = sources
      .slice(0, 2)
      .map((s) => s.title || s.url || '')
      .filter(Boolean)
      .join(', ');
    return { type: 'model', detail: cited ? `Model (cited: ${cited})` : 'Model' };
  }
  return { type: 'model', detail: 'Model (training data)' };
}

function InspectorPanel({ item, groupLabel, groupColor, onClose }: InspectorPanelProps) {
  const src = sourceLabel(item.provenance);
  const sources = item.provenance?.sources || [];

  return (
    <div
      className="flex flex-col h-full"
      style={{ animation: 'slideInRight 0.15s ease-out forwards' }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-stroke-subtle flex-shrink-0">
        <div
          className="w-8 h-8 flex-shrink-0 rounded flex items-center justify-center mt-0.5"
          style={{ backgroundColor: `${groupColor}18` }}
        >
          <ChevronRight className="w-3.5 h-3.5" style={{ color: groupColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: groupColor }}>
            {groupLabel}
          </span>
          <h2 className="text-sm font-semibold text-text-primary leading-snug mt-0.5 line-clamp-3">
            {item.name}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-subtle transition-colors flex-shrink-0 text-text-tertiary"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {item.description && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
              Overview
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>
          </section>
        )}

        {/* Stakeholder-specific fields */}
        {(item.influence_level || item.impact_level || item.engagement_priority) && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
              Assessment
            </h3>
            <div className="space-y-1.5">
              {item.influence_level && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">Influence</span>
                  <span className="font-medium text-text-secondary">{item.influence_level}</span>
                </div>
              )}
              {item.impact_level && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">Impact</span>
                  <span className="font-medium text-text-secondary">{item.impact_level}</span>
                </div>
              )}
              {item.engagement_priority && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">Priority</span>
                  <span className="font-medium text-text-secondary">{item.engagement_priority}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {item.role_in_project && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
              Role in Project
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">{item.role_in_project}</p>
          </section>
        )}

        {/* Provenance */}
        <section>
          <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
            Source
          </h3>
          <div className="flex items-start gap-2">
            <span
              className={`mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                src.type === 'user'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-surface-subtle text-text-tertiary'
              }`}
            >
              {src.type === 'user' ? 'User' : 'AI'}
            </span>
            <span className="text-xs text-text-secondary leading-relaxed">{src.detail}</span>
          </div>
        </section>

        {sources.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
              Citations
            </h3>
            <div className="space-y-1.5">
              {sources.slice(0, 4).map((s, idx) => (
                <div key={idx} className="flex items-start gap-1.5 min-w-0">
                  <ExternalLink className="w-3 h-3 text-text-tertiary flex-shrink-0 mt-0.5" />
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline leading-snug break-words min-w-0"
                    >
                      {s.title || s.url}
                    </a>
                  ) : (
                    <span className="text-xs text-text-secondary leading-snug break-words min-w-0">
                      {s.title}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {sources.length === 0 && src.type === 'model' && (
          <p className="text-xs text-text-tertiary italic">
            Derived from generally available information. Validate against primary sources.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

export function AssessmentMapWidget({
  data,
  instanceId,
  initiativeId,
}: WorkspaceWidgetProps) {
  const mapData = data as AssessmentMapData;
  const groups: AssessmentGroup[] = mapData?.groups ?? [];

  const [selectedItem, setSelectedItem] = useState<AssessmentItem | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<AssessmentGroup | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, true]))
  );
  const [exportingWriteup, setExportingWriteup] = useState(false);
  const [exportingLog, setExportingLog] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleItemClick = useCallback(
    (item: PlanWorkspaceItem, group: PlanWorkspaceGroup) => {
      const rawGroup = groups.find((g) => g.id === group.id) ?? null;
      const rawItem = rawGroup?.items.find((i) => i.id === item.id) ?? null;
      if (rawItem && rawGroup) {
        setSelectedItem(rawItem);
        setSelectedGroup(rawGroup);
      }
    },
    [groups],
  );

  const handleExport = useCallback(
    async (type: 'writeup' | 'decision-log') => {
      if (!instanceId) return;
      const setLoading = type === 'writeup' ? setExportingWriteup : setExportingLog;
      setLoading(true);
      setExportError(null);
      try {
        const { blob, filename } =
          type === 'writeup'
            ? await api.exportAssessmentWriteup(instanceId)
            : await api.exportAssessmentDecisionLog(instanceId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e: any) {
        setExportError(e.message ?? 'Export failed');
      } finally {
        setLoading(false);
      }
    },
    [instanceId],
  );

  if (!groups.length) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-secondary">
        No data to display yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Export toolbar */}
      <div className="flex items-center justify-between pb-3">
        <p className="text-xs text-text-tertiary">
          {groups.length} {groups.length === 1 ? 'category' : 'categories'} ·{' '}
          {groups.reduce((n, g) => n + g.items.length, 0)} items — click an item to explore
        </p>
        <div className="flex items-center gap-2">
          {exportError && (
            <span className="text-xs text-red-500">{exportError}</span>
          )}
          <button
            onClick={() => handleExport('decision-log')}
            disabled={exportingLog}
            className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1.5"
          >
            {exportingLog ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ClipboardList className="w-3 h-3" />
            )}
            Decision Log
          </button>
          <button
            onClick={() => handleExport('writeup')}
            disabled={exportingWriteup}
            className="btn-primary !py-1 !px-2.5 text-xs flex items-center gap-1.5"
          >
            {exportingWriteup ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
            Write-up
          </button>
        </div>
      </div>

      {/* Main area: diagram + inspector */}
      <div className="flex gap-0 border border-divider rounded-lg overflow-hidden flex-1" style={{ minHeight: 400 }}>
        {/* Horizontal scroll for pillar columns */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-3">
          <div
            className="flex gap-3 pb-2"
            style={{ minWidth: `${groups.length * 216}px` }}
          >
            {groups.map((group) => {
              const planGroup: PlanWorkspaceGroup = {
                id: group.id,
                name: group.label,
                icon: group.icon,
                items: group.items.map((item) => ({
                  id: item.id,
                  title: item.name,
                  kind: 'assessment' as const,
                  classification: 'unknown' as const,
                  status: 'not_started' as const,
                  rationale: item.description,
                  groupId: group.id,
                  groupName: group.label,
                })),
              };

              return (
                <div key={group.id} className="flex-shrink-0 w-52">
                  <PlanStructureColumn
                    group={planGroup}
                    color={group.color}
                    expanded={expandedGroups[group.id] !== false}
                    onToggleExpanded={() =>
                      setExpandedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                    }
                    onOpenItem={handleItemClick}
                    showItemKindBadge={false}
                    showItemCompleteToggle={false}
                    showItemBranchDelete={false}
                    showItemRightActions={false}
                    enableItemSorting={false}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Inspector panel */}
        {selectedItem && selectedGroup && (
          <div className="border-l border-divider overflow-y-auto" style={{ width: 296 }}>
            <InspectorPanel
              item={selectedItem}
              groupLabel={selectedGroup.label}
              groupColor={selectedGroup.color}
              onClose={() => {
                setSelectedItem(null);
                setSelectedGroup(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default AssessmentMapWidget;

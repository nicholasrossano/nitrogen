'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Loader2, X, Sparkles } from 'lucide-react';
import type { BuildItem, FieldDef, StageDef, StageState } from '@/lib/api';
import { api } from '@/lib/api';
import { PlanStructureColumn } from '@/components/plan-workspace/PlanStructureColumn';
import type { PlanWorkspaceGroup, PlanWorkspaceItem } from '@/components/plan-workspace/types';
import { inferCategoryIconName } from './categoryIcons';

// Gradient-ordered palette matching ProjectPlanView
const CATEGORY_COLORS = [
  '#005e72', '#4a6680', '#8d5e6a', '#7a5030',
  '#a06548', '#7a6520', '#7a7a3a', '#6b7d6a',
];

// ── Deep Dive / Record Panel ──────────────────────────────────────────────

interface RecordPanelProps {
  item: BuildItem;
  record: Record<string, any> | undefined;
  fields: FieldDef[];
  readOnly: boolean;
  onClose: () => void;
  onEnrich: () => Promise<void>;
  onSaveField: (fieldName: string, value: string) => Promise<void>;
}

function FieldEditor({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  if (readOnly) {
    return (
      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
        {value || <span className="italic text-text-tertiary">Not filled</span>}
      </p>
    );
  }

  if (field.field_type === 'select' && field.options?.length) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-surface border border-divider rounded px-2 py-1.5 outline-none focus:border-accent/60 text-text-primary"
      >
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (field.field_type === 'long_text') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={field.placeholder ?? ''}
        className="w-full text-xs bg-surface border border-divider rounded px-2 py-1.5 outline-none focus:border-accent/60 text-text-primary resize-none leading-relaxed"
      />
    );
  }

  return (
    <input
      type={field.field_type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder ?? ''}
      className="w-full text-xs bg-surface border border-divider rounded px-2 py-1.5 outline-none focus:border-accent/60 text-text-primary"
    />
  );
}

function RecordPanel({ item, record, fields, readOnly, onClose, onEnrich, onSaveField }: RecordPanelProps) {
  const name = String(item.content.name ?? item.content.title ?? item.content.label ?? 'Item');
  const [localValues, setLocalValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, String(record?.[f.name] ?? '')]))
  );
  const [enriching, setEnriching] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync if record prop changes (e.g. after enrich)
  useEffect(() => {
    setLocalValues(Object.fromEntries(fields.map((f) => [f.name, String(record?.[f.name] ?? '')])));
  }, [record, fields]);

  const handleEnrich = async () => {
    setEnriching(true);
    try { await onEnrich(); } finally { setEnriching(false); }
  };

  const handleBlur = async (fieldName: string) => {
    const current = String(record?.[fieldName] ?? '');
    if (localValues[fieldName] === current) return;
    setSaving(fieldName);
    try { await onSaveField(fieldName, localValues[fieldName]); } finally { setSaving(null); }
  };

  return (
    <div ref={panelRef} className="flex flex-col h-full border-l border-divider bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
        <div>
          <p className="text-xs text-text-tertiary">Details</p>
          <h3 className="text-sm font-semibold text-text-primary">{name}</h3>
        </div>
        <div className="flex items-center gap-1">
          {!readOnly && (
            <button
              onClick={handleEnrich}
              disabled={enriching}
              className="btn-secondary !py-1 !px-2 text-[11px] flex items-center gap-1"
            >
              {enriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {enriching ? 'Generating…' : 'AI Fill'}
            </button>
          )}
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {fields.map((f) => (
          <div key={f.name}>
            <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
              {f.label ?? f.name}
              {saving === f.name && <span className="text-text-tertiary font-normal ml-1">Saving…</span>}
            </label>
            <FieldEditor
              field={f}
              value={localValues[f.name] ?? ''}
              onChange={(v) => setLocalValues((lv) => ({ ...lv, [f.name]: v }))}
              readOnly={readOnly}
            />
            {!readOnly && (
              <div
                // Using an invisible blur trap on the wrapper to detect when focus leaves this field
                onBlur={() => handleBlur(f.name)}
                className="h-0"
              />
            )}
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-xs text-text-tertiary italic">No detail fields configured.</p>
        )}
      </div>
    </div>
  );
}

// ── Main CategorizedWorkspaceStage ────────────────────────────────────────

interface Props {
  instanceId: string;
  stageId: string;
  workflowVersion?: number;
  stageDef: StageDef;
  stageData: StageState['data'];
  /** Items from the prior list stage (used as category groupings) */
  categoryItems: BuildItem[];
  readOnly: boolean;
  onChanged: () => void;
  onAddToChat?: (text: string) => void;
}

export function CategorizedWorkspaceStage({
  instanceId,
  stageId,
  workflowVersion,
  stageDef,
  stageData,
  categoryItems,
  readOnly,
  onChanged,
}: Props) {
  const [selectedItem, setSelectedItem] = useState<BuildItem | null>(null);
  const [panelWidth] = useState(360);
  const [expandedByGroup, setExpandedByGroup] = useState<Record<string, boolean>>({});

  const isRecord = stageDef.component === 'record';
  const items: BuildItem[] = useMemo(() => stageData?.items ?? [], [stageData?.items]);
  const records: Record<string, Record<string, any>> = useMemo(() => stageData?.records ?? {}, [stageData?.records]);
  const fields: FieldDef[] = stageDef.fields ?? [];
  const categoryLabelById = useMemo(() => {
    return Object.fromEntries(
      categoryItems.map((cat) => [
        cat.id,
        String(cat.content.label ?? cat.content.name ?? cat.content.title ?? 'Uncategorized'),
      ])
    );
  }, [categoryItems]);

  const groupRows: Array<{ group: PlanWorkspaceGroup; buildItems: BuildItem[] }> = useMemo(() => {
    const grouped = categoryItems.length
      ? categoryItems.map((cat) => {
          const catLabel = String(cat.content.label ?? cat.content.name ?? cat.content.title ?? 'Uncategorized');
          const groupBuildItems = items.filter((item) => {
            const itemCat = String(item.content.category ?? item.content.category_label ?? '');
            return itemCat === catLabel;
          });
          const planItems: PlanWorkspaceItem[] = groupBuildItems.map((item) => ({
            id: item.id,
            title: String(item.content.name ?? item.content.title ?? item.content.label ?? 'Item'),
            kind: 'assessment' as const,
            classification: 'required' as const,
            status: 'not_started' as const,
            groupId: cat.id,
            groupName: catLabel,
            userAdded: item.provenance?.derivation === 'provided',
          }));
          return {
            group: {
              id: cat.id,
              name: catLabel,
              icon: String(cat.content.icon ?? inferCategoryIconName(catLabel)),
              items: planItems,
            },
            buildItems: groupBuildItems,
          };
        })
      : [
          {
            group: {
              id: '__all__',
              name: 'All',
              icon: 'Compass',
              items: items.map((item) => ({
                id: item.id,
                title: String(item.content.name ?? item.content.title ?? item.content.label ?? 'Item'),
                kind: 'assessment' as const,
                classification: 'required' as const,
                status: 'not_started' as const,
                groupId: '__all__',
                groupName: 'All',
                userAdded: item.provenance?.derivation === 'provided',
              })),
            },
            buildItems: items,
          },
        ];
    return grouped;
  }, [categoryItems, items]);

  useEffect(() => {
    setExpandedByGroup((prev) => {
      const next = { ...prev };
      for (const row of groupRows) {
        if (!(row.group.id in next)) next[row.group.id] = true;
      }
      return next;
    });
  }, [groupRows]);

  // Add item
  const handleAdd = useCallback(
    async (groupId: string, title: string) => {
      const categoryLabel = categoryLabelById[groupId] ?? 'Uncategorized';
      await api.addStageItem(instanceId, stageId, { name: title, category: categoryLabel }, workflowVersion);
      onChanged();
    },
    [instanceId, stageId, onChanged, categoryLabelById, workflowVersion]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      if (selectedItem?.id === itemId) setSelectedItem(null);
      await api.deleteStageItem(instanceId, stageId, itemId, workflowVersion);
      onChanged();
    },
    [instanceId, stageId, onChanged, selectedItem, workflowVersion]
  );

  const handleReorderWithinGroup = useCallback(
    async (groupItemIds: string[]) => {
      if (!groupItemIds.length) return;
      const target = new Set(groupItemIds);
      let idx = 0;
      const reorderedAll = items.map((item) => {
        if (!target.has(item.id)) return item.id;
        const nextId = groupItemIds[idx];
        idx += 1;
        return nextId;
      });
      await api.reorderStageItems(instanceId, stageId, reorderedAll, workflowVersion);
      onChanged();
    },
    [instanceId, stageId, items, onChanged, workflowVersion]
  );

  const handleEnrich = useCallback(
    async (itemId: string) => {
      await api.enrichRecord(instanceId, stageId, itemId, workflowVersion);
      onChanged();
    },
    [instanceId, stageId, onChanged, workflowVersion]
  );

  const handleSaveField = useCallback(
    async (itemId: string, fieldName: string, value: string) => {
      await api.updateRecord(instanceId, stageId, itemId, { [fieldName]: value }, workflowVersion);
      onChanged();
    },
    [instanceId, stageId, onChanged, workflowVersion]
  );

  const panelOpen = !!selectedItem && isRecord;

  return (
    <div className="flex min-h-0 gap-0 overflow-hidden" style={{ minHeight: 400 }}>
      <div className="flex-1 overflow-y-auto p-1">
        <div className="space-y-4">
          {groupRows.map((row, idx) => (
            <PlanStructureColumn
              key={row.group.id}
              group={row.group}
              color={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
              expanded={expandedByGroup[row.group.id] ?? true}
              onToggleExpanded={() =>
                setExpandedByGroup((prev) => ({
                  ...prev,
                  [row.group.id]: !(prev[row.group.id] ?? true),
                }))
              }
              onDeleteItem={!readOnly ? handleDelete : undefined}
              onOpenItem={isRecord ? (planItem) => {
                const selected = row.buildItems.find((item) => item.id === planItem.id) ?? null;
                setSelectedItem((prev) => (prev?.id === selected?.id ? null : selected));
              } : undefined}
              onAddItem={!readOnly ? (groupId, title) => handleAdd(groupId, title) : undefined}
              showItemKindBadge={false}
              showItemCompleteToggle={false}
              showItemBranchDelete={false}
              showItemRightActions={!readOnly}
              enableItemSorting={!readOnly}
              onReorderItems={!readOnly ? handleReorderWithinGroup : undefined}
            />
          ))}
        </div>
      </div>

      {/* Record / Detail panel */}
      {panelOpen && selectedItem && (
        <div
          className="shrink-0 overflow-hidden flex flex-col"
          style={{ width: panelWidth }}
        >
          <RecordPanel
            item={selectedItem}
            record={records[selectedItem.id]}
            fields={fields}
            readOnly={readOnly}
            onClose={() => setSelectedItem(null)}
            onEnrich={() => handleEnrich(selectedItem.id)}
            onSaveField={(fieldName, value) => handleSaveField(selectedItem.id, fieldName, value)}
          />
        </div>
      )}
    </div>
  );
}

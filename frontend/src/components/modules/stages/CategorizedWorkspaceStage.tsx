'use client';

import { useState, useCallback, useLayoutEffect, useEffect, useRef } from 'react';
import { Loader2, X, Sparkles, ChevronRight, Trash2, Plus } from 'lucide-react';
import type { BuildItem, FieldDef, StageDef, StageState } from '@/lib/api';
import { api } from '@/lib/api';

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

// ── Category column (pillar-style) ────────────────────────────────────────

interface CategoryColumnProps {
  label: string;
  color: string;
  items: BuildItem[];
  selectedItemId: string | null;
  onSelectItem: (item: BuildItem) => void;
  onDeleteItem: (itemId: string) => void;
  onAddItem?: (content: Record<string, any>) => Promise<void>;
  readOnly: boolean;
}

function CategoryColumn({
  label, color, items, selectedItemId, onSelectItem, onDeleteItem, onAddItem, readOnly,
}: CategoryColumnProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) setTimeout(() => inputRef.current?.focus(), 0);
  }, [adding]);

  const handleCommit = async () => {
    const name = newName.trim();
    if (!name || !onAddItem || saving) return;
    setSaving(true);
    try {
      await onAddItem({ name });
      setNewName('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-divider bg-surface flex flex-col min-w-0">
      {/* Column header */}
      <div className="px-3 pt-3 pb-2 border-b border-divider" style={{ borderTopColor: color, borderTopWidth: 3, borderTopStyle: 'solid' }}>
        <h4 className="text-xs font-semibold text-text-primary leading-tight">{label}</h4>
        <p className="text-[11px] text-text-tertiary mt-0.5">{items.length} item{items.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Items */}
      <div className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const name = String(item.content.name ?? item.content.title ?? item.content.label ?? 'Item');
          const isSelected = item.id === selectedItemId;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer group transition-colors ${
                isSelected ? 'bg-accent/10 text-accent' : 'hover:bg-surface-subtle text-text-primary'
              }`}
              onClick={() => onSelectItem(item)}
            >
              <span className="flex-1 text-xs font-medium leading-snug">{name}</span>
              <ChevronRight className={`w-3 h-3 shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
              {!readOnly && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteItem(item.id); }}
                  className="p-0.5 text-text-tertiary hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add item */}
        {!readOnly && adding && (
          <div className="px-2 py-1.5 rounded-lg bg-accent/5">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommit();
                if (e.key === 'Escape') { setAdding(false); setNewName(''); }
              }}
              onBlur={() => { if (!newName.trim()) { setAdding(false); } }}
              placeholder="Name…"
              className="w-full text-xs bg-transparent outline-none text-text-primary placeholder:text-text-tertiary"
            />
          </div>
        )}
      </div>

      {!readOnly && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-3 py-2 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors border-t border-divider"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      )}
    </div>
  );
}

// ── Main CategorizedWorkspaceStage ────────────────────────────────────────

interface Props {
  instanceId: string;
  stageId: string;
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
  stageDef,
  stageData,
  categoryItems,
  readOnly,
  onChanged,
}: Props) {
  const [selectedItem, setSelectedItem] = useState<BuildItem | null>(null);
  const [panelWidth] = useState(360);
  const outerRef = useRef<HTMLDivElement>(null);
  const [numCols, setNumCols] = useState(3);

  const computeCols = (w: number, panelOpen: boolean) =>
    panelOpen ? (w >= 900 ? 3 : w >= 600 ? 2 : 1) : (w >= 700 ? 3 : w >= 450 ? 2 : 1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setNumCols(computeCols(entry.contentRect.width, !!selectedItem));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [selectedItem]);

  const isRecord = stageDef.component === 'record';
  const items: BuildItem[] = stageData?.items ?? [];
  const records: Record<string, Record<string, any>> = stageData?.records ?? {};
  const fields: FieldDef[] = stageDef.fields ?? [];

  // Group items by their category field (matching category items by label)
  const categoryField = fields.find((f) => f.name === 'category');
  const groupedItems: Array<{ category: Pick<BuildItem, 'id' | 'content'>; items: BuildItem[] }> = categoryItems.length
    ? categoryItems.map((cat) => {
        const catLabel = String(cat.content.label ?? cat.content.name ?? cat.content.title ?? '');
        return {
          category: cat,
          items: items.filter((item) => {
            const itemCat = String(item.content.category ?? item.content.category_label ?? '');
            return itemCat === catLabel;
          }),
        };
      })
    : [{ category: { id: '__all__', content: { label: 'All' } }, items }];

  // Add item
  const handleAdd = useCallback(
    async (categoryLabel: string, content: Record<string, any>) => {
      await api.addStageItem(instanceId, stageId, { ...content, category: categoryLabel });
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      if (selectedItem?.id === itemId) setSelectedItem(null);
      await api.deleteStageItem(instanceId, stageId, itemId);
      onChanged();
    },
    [instanceId, stageId, onChanged, selectedItem]
  );

  const handleEnrich = useCallback(
    async (itemId: string) => {
      await api.enrichRecord(instanceId, stageId, itemId);
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  const handleSaveField = useCallback(
    async (itemId: string, fieldName: string, value: string) => {
      await api.updateRecord(instanceId, stageId, itemId, { [fieldName]: value });
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  const panelOpen = !!selectedItem && isRecord;

  return (
    <div ref={outerRef} className="flex min-h-0 gap-0 overflow-hidden" style={{ minHeight: 400 }}>
      {/* Grid */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1">
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${numCols}, minmax(0, 1fr))` }}
        >
          {groupedItems.map((group, idx) => {
            const catLabel = String(group.category.content.label ?? group.category.content.name ?? group.category.content.title ?? 'Uncategorized');
            const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
            return (
              <CategoryColumn
                key={group.category.id}
                label={catLabel}
                color={color}
                items={group.items}
                selectedItemId={selectedItem?.id ?? null}
                onSelectItem={(item) => {
                  if (isRecord) setSelectedItem((prev) => prev?.id === item.id ? null : item);
                }}
                onDeleteItem={handleDelete}
                onAddItem={!readOnly ? (content) => handleAdd(catLabel, content) : undefined}
                readOnly={readOnly}
              />
            );
          })}
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

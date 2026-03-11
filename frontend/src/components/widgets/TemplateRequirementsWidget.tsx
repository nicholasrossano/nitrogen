'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  CircleDot,
  FileText,
  Download,
  Loader2,
  Minus,
} from 'lucide-react';
import { api } from '@/lib/api';

interface RequirementSource {
  source_type: string;
  source_id: string;
  source_title: string;
  quote: string;
  similarity: number;
}

interface SubField {
  id: string;
  label: string;
  field_type: string;
  source_location: string;
  value?: string | null;
}

interface TemplateRequirement {
  id: string;
  label: string;
  description: string;
  category: string;
  field_type: string;
  is_calculated: boolean;
  is_mandatory: boolean;
  source_location: string;
  status: string;
  value: string | null;
  sources: RequirementSource[];
  confidence: number;
  parent_id?: string | null;
  condition?: string | null;
  sub_fields?: SubField[];
}

interface TemplateSummary {
  total: number;
  supported: number;
  partial: number;
  missing: number;
  needs_confirmation: number;
}

interface TemplateRequirementsWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
  messageId?: string;
  onRecalculated?: (newData: Record<string, any>) => void;
  onSendMessage?: (content: string) => void;
  onGenerate?: () => void;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon: typeof CheckCircle2; label: string }> = {
  confirmed:            { bg: 'bg-green-50',  text: 'text-green-700',  icon: CheckCircle2, label: 'Confirmed' },
  inferred:             { bg: 'bg-blue-50',   text: 'text-blue-700',   icon: CircleDot,    label: 'Inferred' },
  supported:            { bg: 'bg-blue-50',   text: 'text-blue-700',   icon: CircleDot,    label: 'Inferred' },
  partially_supported:  { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: CircleDot,    label: 'Partial' },
  assumed:              { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: HelpCircle,   label: 'Assumed' },
  missing:              { bg: 'bg-red-50',    text: 'text-red-700',    icon: AlertCircle,  label: 'Missing' },
  needs_confirmation:   { bg: 'bg-blue-50',   text: 'text-blue-700',   icon: HelpCircle,   label: 'Confirm' },
};

function resolveDisplayStatus(req: TemplateRequirement): string {
  if (req.status === 'supported') {
    return (req.sources && req.sources.length > 0) ? 'inferred' : 'confirmed';
  }
  // For requirements with sub_fields, derive status from sub_field values
  if (req.sub_fields && req.sub_fields.length > 0) {
    const filled = req.sub_fields.filter((sf) => sf.value).length;
    if (filled === req.sub_fields.length) return 'confirmed';
    if (filled > 0) return 'partially_supported';
  }
  return req.status;
}

function truncateWords(text: string, count: number): string {
  const words = text.split(/\s+/);
  return words.length <= count ? text : words.slice(0, count).join(' ') + '...';
}

export function TemplateRequirementsWidget({
  data,
  initiativeId,
  isActive = true,
  messageId,
  onRecalculated,
  onSendMessage,
  onGenerate,
}: TemplateRequirementsWidgetProps) {
  const requirements: TemplateRequirement[] = data?.requirements || [];
  const summary: TemplateSummary = data?.summary || { total: 0, supported: 0, partial: 0, missing: 0, needs_confirmation: 0 };
  const filename: string = data?.filename || 'Template';
  const templateId: string = data?.template_id || '';

  const [localReqs, setLocalReqs] = useState<TemplateRequirement[]>(requirements);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [tooltipReq, setTooltipReq] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoveredRowReq, setHoveredRowReq] = useState<TemplateRequirement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [overInteractive, setOverInteractive] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Build a global index map so each requirement has a stable sequential number
  const globalIndex = useRef<Map<string, number>>(new Map());
  if (globalIndex.current.size === 0 && localReqs.length > 0) {
    localReqs.forEach((r, i) => globalIndex.current.set(r.id, i + 1));
  }
  const getNumber = useCallback((id: string) => globalIndex.current.get(id) ?? 0, []);

  const categories = Array.from(new Set(localReqs.map((r) => r.category)));

  const persistWidget = useCallback((reqs: TemplateRequirement[]) => {
    if (!messageId || !initiativeId) return;
    const updatedSummary = {
      total: reqs.length,
      supported: reqs.filter((r) => ['supported', 'confirmed', 'inferred'].includes(r.status)).length,
      partial: reqs.filter((r) => r.status === 'partially_supported' || r.status === 'assumed').length,
      missing: reqs.filter((r) => r.status === 'missing').length,
      needs_confirmation: reqs.filter((r) => r.status === 'needs_confirmation').length,
    };
    const widgetData = { ...data, requirements: reqs, summary: updatedSummary };
    api.updateMessageWidget(initiativeId, messageId, widgetData).catch(() => {});
    onRecalculated?.(widgetData);
  }, [messageId, initiativeId, data, onRecalculated]);

  const updateReqValue = useCallback((reqId: string, value: string | null) => {
    setLocalReqs((prev) => {
      const updated = prev.map((r) =>
        r.id === reqId
          ? { ...r, value, status: value ? 'confirmed' : 'missing' }
          : r,
      );
      persistWidget(updated);
      return updated;
    });
  }, [persistWidget]);

  const updateSubFieldValue = useCallback((reqId: string, sfIndex: number, value: string | null) => {
    setLocalReqs((prev) => {
      const updated = prev.map((r) => {
        if (r.id !== reqId || !r.sub_fields) return r;
        const newSubs = r.sub_fields.map((sf, idx) =>
          idx === sfIndex ? { ...sf, value } : sf,
        );
        const allFilled = newSubs.every((sf) => sf.value);
        return {
          ...r,
          sub_fields: newSubs,
          status: allFilled && (!r.value && (r.field_type === 'text' && !r.source_location) || r.value) ? 'confirmed' : r.status,
        };
      });
      persistWidget(updated);
      return updated;
    });
  }, [persistWidget]);

  // Listen for confirmed template field values from the proposed-value widget
  useEffect(() => {
    const handler = (e: Event) => {
      const { requirement_label, value } = (e as CustomEvent).detail ?? {};
      if (!requirement_label || !value) return;
      const match = localReqs.find((r) => r.label === requirement_label);
      if (match) updateReqValue(match.id, value);
    };
    window.addEventListener('nitrogen:template-field-confirmed', handler);
    return () => window.removeEventListener('nitrogen:template-field-confirmed', handler);
  }, [localReqs, updateReqValue]);

  const startEdit = (req: TemplateRequirement) => {
    setEditingId(req.id);
    setEditValue(req.value || '');
  };

  const commitEdit = (reqId: string) => {
    updateReqValue(reqId, editValue || null);
    setEditingId(null);
  };

  const confirmValue = (reqId: string) => {
    setLocalReqs((prev) => {
      const updated = prev.map((r) =>
        r.id === reqId ? { ...r, status: 'confirmed' } : r,
      );
      persistWidget(updated);
      return updated;
    });
  };

  const deleteReq = useCallback((reqId: string) => {
    setLocalReqs((prev) => {
      const updated = prev.filter((r) => r.id !== reqId && r.parent_id !== reqId);
      persistWidget(updated);
      return updated;
    });
  }, [persistWidget]);

  const deleteSubField = useCallback((reqId: string, sfIndex: number) => {
    setLocalReqs((prev) => {
      const updated = prev.map((r) => {
        if (r.id !== reqId || !r.sub_fields) return r;
        const newSubs = r.sub_fields.filter((_, idx) => idx !== sfIndex);
        return { ...r, sub_fields: newSubs };
      });
      persistWidget(updated);
      return updated;
    });
  }, [persistWidget]);

  const investigate = useCallback((req: TemplateRequirement) => {
    setHoveredRowReq(null);
    const num = getNumber(req.id);
    const shortLabel = `Question #${num}: ${truncateWords(req.label, 3)}`;

    // Build context block so the LLM knows the full form context
    const catReqs = localReqs.filter((r) => r.category === req.category);
    const neighborLines = catReqs
      .map((r) => {
        const n = getNumber(r.id);
        const val = r.value ? ` = ${r.value}` : ' (missing)';
        return `  #${n}. ${r.label}${val}`;
      })
      .join('\n');

    const contextBlock =
      `[TEMPLATE_CONTEXT]\n` +
      `Template: ${filename}\n` +
      `Category: ${req.category}\n` +
      `Field type: ${req.field_type}\n` +
      `Question #${num}: ${req.label}\n` +
      (req.description && req.description !== req.label ? `Description: ${req.description}\n` : '') +
      `Current value: ${req.value || 'Not provided'}\n` +
      `Status: ${req.status}\n` +
      `Neighboring fields in this section:\n${neighborLines}\n` +
      `[/TEMPLATE_CONTEXT]`;

    const text =
      `Can you help me determine where I would get this information and, if possible, help me come up with a value?\n\n` +
      `*${req.label}*\n\n${contextBlock}`;
    window.dispatchEvent(new CustomEvent('nitrogen:draft', { detail: { text, label: shortLabel } }));
  }, [getNumber, localReqs, filename]);

  const currentSummary = {
    total: localReqs.length,
    confirmed: localReqs.filter((r) => r.status === 'confirmed').length,
    inferred: localReqs.filter((r) => r.status === 'supported' || r.status === 'inferred').length,
    partial: localReqs.filter((r) => r.status === 'partially_supported' || r.status === 'assumed').length,
    missing: localReqs.filter((r) => r.status === 'missing').length,
    needs_confirmation: localReqs.filter((r) => r.status === 'needs_confirmation').length,
  };
  const resolvedCount = currentSummary.confirmed + currentSummary.inferred;

  const [generating, setGenerating] = useState(false);

  const readyToGenerate = currentSummary.missing === 0 && currentSummary.needs_confirmation === 0;

  const handleGenerate = useCallback(async () => {
    if (onGenerate) {
      onGenerate();
      return;
    }
    if (!templateId || !initiativeId) return;
    setGenerating(true);
    try {
      const result = await api.generateFromTemplate(initiativeId, templateId, localReqs);
      await api.exportTemplate(result.template_id, result.filename);
    } catch (err) {
      console.error('Template generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [onGenerate, templateId, initiativeId, localReqs]);

  const MAGNIFY_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%231a1a1a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6.5' cy='6.5' r='4.5'/%3E%3Cline x1='10' y1='10' x2='14.5' y2='14.5'/%3E%3C/svg%3E") 6 6, auto`;

  /** Determine if a parent's current value matches a child's condition */
  const parentValueMatchesCondition = (parentValue: string | null, condition: string | null): boolean => {
    if (!parentValue || !condition) return false;
    const pv = parentValue.toLowerCase();
    const cond = condition.toLowerCase();
    if (cond === 'yes') return pv === 'yes' || pv === 'true';
    if (cond === 'no') return pv === 'no' || pv === 'false';
    if (cond === 'true') return pv === 'true' || pv === 'yes';
    if (cond === 'false') return pv === 'false' || pv === 'no';
    return pv === cond;
  };

  /** Render conditional children indented below their parent */
  const renderChildren = (parent: TemplateRequirement, children: TemplateRequirement[]) => {
    if (!parent.value) return null;
    const visible = children.filter((c) => parentValueMatchesCondition(parent.value, c.condition ?? null));
    if (visible.length === 0) return null;
    return (
      <div className="ml-6 mt-1 relative">
        {visible.map((child, idx) => {
          const isLast = idx === visible.length - 1;
          return (
            <div key={child.id} className="flex items-stretch group/subnode">
              {/* Branch gutter — all absolute lines, guaranteed connected */}
              <div className="w-8 flex-shrink-0 relative">
                {/* Vertical line: top-0 to center for last, full height for others */}
                <div className={`absolute left-1/2 top-0 w-px bg-stroke-subtle ${isLast ? 'h-1/2' : 'h-full'}`} />
                {/* Horizontal line: center to right edge */}
                <div className="absolute top-1/2 left-1/2 right-0 h-px bg-stroke-subtle" />
                {/* Dot + delete button at intersection */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <div className="relative w-3 h-3">
                    <div className="w-3 h-3 rounded-full bg-stroke-muted transition-opacity duration-200 group-hover/subnode:opacity-0" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteReq(child.id); }}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 opacity-0 scale-50 group-hover/subnode:opacity-100 group-hover/subnode:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out"
                      aria-label="Remove question"
                    >
                      <Minus className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                </div>
              </div>
              {/* Child tile */}
              <div className="flex-1 min-w-0 py-1.5 pr-1">
                {renderTile(child)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /** Render sub-fields as separate tiles with curved branch lines */
  const renderSubFields = (req: TemplateRequirement) => {
    const sfs = req.sub_fields;
    if (!sfs || sfs.length === 0) return null;
    return (
      <div className="ml-6 mt-1 relative">
        {sfs.map((sf, sfIdx) => {
          const sfBool = sf.field_type === 'boolean';
          const sfYesNo = sf.field_type === 'yes_no';
          const sfToggle = sfBool || sfYesNo;
          const isLast = sfIdx === sfs.length - 1;
          return (
            <div key={`${req.id}_sf_${sfIdx}`} className="flex items-stretch group/subnode">
              {/* Branch gutter — all absolute lines, guaranteed connected */}
              <div className="w-8 flex-shrink-0 relative">
                {/* Vertical line: top-0 to center for last, full height for others */}
                <div className={`absolute left-1/2 top-0 w-px bg-stroke-subtle ${isLast ? 'h-1/2' : 'h-full'}`} />
                {/* Horizontal line: center to right edge */}
                <div className="absolute top-1/2 left-1/2 right-0 h-px bg-stroke-subtle" />
                {/* Dot + delete button at intersection */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <div className="relative w-3 h-3">
                    <div className="w-3 h-3 rounded-full bg-stroke-muted transition-opacity duration-200 group-hover/subnode:opacity-0" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteSubField(req.id, sfIdx); }}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 opacity-0 scale-50 group-hover/subnode:opacity-100 group-hover/subnode:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out"
                      aria-label="Remove sub-field"
                    >
                      <Minus className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                </div>
              </div>
              {/* Sub-field tile */}
              <div className="flex-1 min-w-0 py-1.5 pr-1">
                <div className="rounded-lg border border-stroke-subtle hover:border-stroke-muted transition-colors px-3 py-2 flex items-center gap-2">
                  <span className="text-[11px] text-text-secondary leading-snug shrink-0 max-w-[45%]">
                    {sf.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    {sfToggle ? (
                      <div className="flex items-center gap-1">
                        {(['Yes', 'No'] as const).map((opt) => {
                          const bMatch = opt === 'Yes' ? (sf.value === 'true' || sf.value === 'Yes') : (sf.value === 'false' || sf.value === 'No');
                          const sel = sfBool ? bMatch : sf.value === opt;
                          const sv = sfBool ? (opt === 'Yes' ? 'true' : 'false') : opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateSubFieldValue(req.id, sfIdx, sv)}
                              className={`text-[10px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                                sel
                                  ? 'bg-surface-subtle border-stroke-muted text-text-primary'
                                  : 'border-stroke-subtle text-text-secondary hover:border-stroke-muted'
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <input
                        type={sf.field_type === 'date' ? 'date' : 'text'}
                        inputMode={sf.field_type === 'number' || sf.field_type === 'currency' ? 'decimal' : undefined}
                        value={sf.value || ''}
                        onChange={(e) => updateSubFieldValue(req.id, sfIdx, e.target.value || null)}
                        placeholder={
                          sf.field_type === 'number' ? 'Enter number...'
                            : sf.field_type === 'currency' ? 'Enter amount...'
                            : sf.field_type === 'date' ? ''
                            : 'Enter value...'
                        }
                        className="w-full text-[11px] px-2 py-0.5 border border-stroke-subtle rounded text-text-primary placeholder:text-text-tertiary hover:border-stroke-muted focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /** Render a single requirement tile (reused for parents and children) */
  const renderTile = (req: TemplateRequirement) => {
    const displayStatus = resolveDisplayStatus(req);
    const cfg = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.missing;
    const isEditing = editingId === req.id;
    const num = getNumber(req.id);
    const ft = req.field_type;
    const isBool = ft === 'boolean';
    const isYesNo = ft === 'yes_no';
    const isInlineToggle = isBool || isYesNo;
    const isMissing = displayStatus === 'missing';
    const hasSubFields = (req.sub_fields?.length ?? 0) > 0;
    const isLabelOnly = hasSubFields;

    return (
      <div
        key={req.id}
        className="group/tile relative rounded-lg border border-stroke-subtle hover:border-stroke-muted transition-colors flex"
        onMouseMove={(e) => {
          const isInteractive = !!(e.target as HTMLElement).closest('button, input, a, label');
          setOverInteractive(isInteractive);
          setMousePos({ x: e.clientX, y: e.clientY });
          setHoveredRowReq(req);
        }}
        onMouseLeave={() => { setHoveredRowReq(null); setOverInteractive(false); }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, input, a, label')) return;
          investigate(req);
        }}
        style={{ cursor: hoveredRowReq?.id === req.id && !overInteractive ? MAGNIFY_CURSOR : undefined }}
      >
        {/* Number circle — fades on hover; minus button covers it */}
        <div className="flex items-center px-3 shrink-0">
          <div className="relative w-5 h-5">
            <span className="absolute inset-0 rounded-full bg-surface-subtle border border-stroke-subtle flex items-center justify-center text-[9px] font-semibold text-text-tertiary leading-none transition-opacity duration-200 group-hover/tile:opacity-0">
              {num}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); deleteReq(req.id); }}
              className="absolute inset-0 w-5 h-5 opacity-0 scale-50 group-hover/tile:opacity-100 group-hover/tile:scale-100 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all duration-200 ease-out z-10"
              aria-label="Remove question"
            >
              <Minus className="w-3 h-3 text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 py-2.5 pr-3">
          {/* Label + status badge */}
          <div className="flex items-start gap-1.5">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-text-primary leading-snug line-clamp-3">
                {req.label}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-1">
              {req.is_calculated && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                  Calc
                </span>
              )}
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
            </div>
          </div>

          {/* Description */}
          {req.description && req.description !== req.label && (
            <p className="text-[11px] text-text-tertiary mt-1 line-clamp-2">
              {req.description}
            </p>
          )}

        {/* Value / input area — hidden when sub_fields provide all inputs */}
        {!isLabelOnly && (
        <div className="mt-1.5 max-w-[75%]">
          {/* Boolean / Yes-No toggle — always show both options */}
          {isInlineToggle && (
            <div className="flex items-center gap-1">
              {(['Yes', 'No'] as const).map((opt) => {
                const boolMatch = opt === 'Yes' ? (req.value === 'true' || req.value === 'Yes') : (req.value === 'false' || req.value === 'No');
                const isSelected = isBool ? boolMatch : req.value === opt;
                const storeVal = isBool ? (opt === 'Yes' ? 'true' : 'false') : opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => updateReqValue(req.id, storeVal)}
                    className={`text-[10px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-surface-subtle border-stroke-muted text-text-primary'
                        : 'border-stroke-subtle text-text-secondary hover:border-stroke-muted'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active edit input */}
          {isEditing && !isInlineToggle ? (
            <div
              className="relative"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setEditingId(null);
                }
              }}
            >
              <input
                autoFocus
                type={ft === 'date' ? 'date' : 'text'}
                inputMode={ft === 'number' || ft === 'currency' ? 'decimal' : undefined}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(req.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-full text-xs pl-2 pr-12 py-1.5 border border-accent/40 rounded focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder={
                  ft === 'number' ? 'Enter number...'
                    : ft === 'currency' ? 'Enter amount...'
                    : ft === 'date' ? ''
                    : 'Enter value...'
                }
              />
              <button
                type="button"
                onClick={() => commitEdit(req.id)}
                className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded bg-accent hover:bg-accent-anchor text-[10px] font-medium text-white transition-colors"
              >
                Save
              </button>
            </div>
          ) : !isInlineToggle && req.value ? (
            /* Existing value — click to edit */
            <div
              className="relative"
              onMouseEnter={() => setTooltipReq(req.id)}
              onMouseLeave={() => setTooltipReq(null)}
            >
              <button
                type="button"
                onClick={() => startEdit(req)}
                className="text-xs font-medium text-text-primary bg-surface-subtle hover:bg-surface-hover px-2 py-0.5 rounded inline-flex items-center gap-1 transition-colors cursor-text"
              >
                {ft === 'currency' && '$'}{req.value}
                {req.sources.length > 0 && (
                  <sup className="text-[9px] text-accent font-bold">[{req.sources.length}]</sup>
                )}
              </button>

              {tooltipReq === req.id && req.sources.length > 0 && (
                <div
                  ref={tooltipRef}
                  className="absolute left-0 top-full mt-1 z-50 w-64 p-2.5 rounded-lg border border-stroke-subtle bg-white shadow-lg"
                >
                  {req.sources.map((s, i) => (
                    <div key={i} className={i > 0 ? 'mt-2 pt-2 border-t border-stroke-subtle' : ''}>
                      <p className="text-[10px] font-semibold text-text-secondary">{s.source_title}</p>
                      <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-3 italic">
                        &ldquo;{s.quote}&rdquo;
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : !isInlineToggle && isMissing && !isEditing ? (
            /* Always-visible enter value field for missing non-toggle items */
            <input
              type={ft === 'number' || ft === 'currency' ? 'number' : ft === 'date' ? 'date' : 'text'}
              step={ft === 'currency' ? '0.01' : undefined}
              placeholder={
                ft === 'number' ? 'Enter number...'
                  : ft === 'currency' ? 'Enter amount...'
                  : ft === 'date' ? ''
                  : 'Enter value...'
              }
              onFocus={() => startEdit(req)}
              readOnly
              className="w-full text-xs px-2 py-1 border border-stroke-subtle rounded text-text-tertiary cursor-text hover:border-stroke-muted transition-colors"
            />
          ) : null}
        </div>
        )}

        {/* Confirm button (inline, no hover gate needed) */}
        {(req.status === 'needs_confirmation' || displayStatus === 'inferred') && req.value && (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => confirmValue(req.id)}
              className="text-[10px] font-medium text-green-700 hover:underline flex items-center gap-0.5"
            >
              <CheckCircle2 className="w-2.5 h-2.5" /> Confirm
            </button>
          </div>
        )}
        </div>{/* close content div */}

      </div>
    );
  };

  return (
    <>
    <div className="card-elevated overflow-hidden h-full rounded-none flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 bg-surface-header border-b border-divider flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary truncate">{filename}</h3>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-3 text-[11px]">
          {currentSummary.confirmed > 0 && (
            <span className="text-green-700 font-medium">{currentSummary.confirmed} confirmed</span>
          )}
          {currentSummary.inferred > 0 && (
            <span className="text-blue-700 font-medium">{currentSummary.inferred} inferred</span>
          )}
          {currentSummary.partial > 0 && (
            <span className="text-yellow-700 font-medium">{currentSummary.partial} partial</span>
          )}
          <span className="text-red-700 font-medium">{currentSummary.missing} missing</span>
          {currentSummary.needs_confirmation > 0 && (
            <span className="text-blue-700 font-medium">{currentSummary.needs_confirmation} to confirm</span>
          )}
          <span className="text-text-tertiary ml-auto">{currentSummary.total} total</span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
            style={{ width: `${currentSummary.total > 0 ? (resolvedCount / currentSummary.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Tab bar */}
      {categories.length > 1 && (
        <div className="flex border-b border-divider bg-white overflow-x-auto">
          <button
            key="all"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveTab('all')}
            className={`shrink-0 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'all'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            All
          </button>
          {categories.map((cat) => {
            const catMissing = localReqs.filter((r) => r.category === cat && r.status === 'missing' && !r.parent_id).length;
            return (
              <button
                key={cat}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setActiveTab(cat)}
                className={`shrink-0 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === cat
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {cat}
                {catMissing > 0 && (
                  <span className="ml-1.5 text-[9px] font-semibold text-red-600 bg-red-50 px-1 py-0.5 rounded-full">
                    {catMissing}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Requirements list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {(activeTab === 'all' ? categories : [activeTab]).map((cat) => {
          const allCatReqs = localReqs.filter((r) => r.category === cat);
          const topLevelReqs = allCatReqs.filter((r) => !r.parent_id);
          return (
            <div key={cat} className="mb-3">
              {activeTab === 'all' && categories.length > 1 && (
                <div className="py-1.5 mb-1">
                  <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
                    {cat}
                  </span>
                </div>
              )}
              <div className="space-y-2">
                {topLevelReqs.map((req) => {
                  const children = allCatReqs.filter((r) => r.parent_id === req.id);
                  return (
                    <div key={req.id}>
                      {renderTile(req)}
                      {(req.sub_fields?.length ?? 0) > 0 && renderSubFields(req)}
                      {children.length > 0 && renderChildren(req, children)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-4 border-t border-divider bg-surface-header flex justify-center">
        <button
          type="button"
          disabled={!isActive || generating}
          onClick={handleGenerate}
          className="btn-primary !text-xs !px-4 !py-1.5"
          style={{ width: '40%' }}
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              {readyToGenerate
                ? 'Generate Document'
                : `Generate (${currentSummary.missing} missing)`}
            </>
          )}
        </button>
      </div>
    </div>

    {mounted && hoveredRowReq && !overInteractive && mousePos && createPortal(
      <div
        className="pointer-events-none fixed z-[9999] px-2 py-0.5 rounded bg-gray-700 text-white text-[11px] font-medium shadow-md whitespace-nowrap"
        style={{ left: mousePos.x + 16, top: mousePos.y - 32 }}
      >
        Investigate
      </div>,
      document.body
    )}
    </>
  );
}

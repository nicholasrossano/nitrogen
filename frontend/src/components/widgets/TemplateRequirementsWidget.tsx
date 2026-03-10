'use client';

import { useState, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  CircleDot,
  Search,
  Pencil,
  ChevronDown,
  ChevronRight,
  FileText,
  Play,
} from 'lucide-react';
import { api } from '@/lib/api';

interface RequirementSource {
  source_type: string;
  source_id: string;
  source_title: string;
  quote: string;
  similarity: number;
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
  supported:            { bg: 'bg-green-50',  text: 'text-green-700',  icon: CheckCircle2, label: 'Supported' },
  partially_supported:  { bg: 'bg-amber-50',  text: 'text-amber-700',  icon: CircleDot,    label: 'Partial' },
  missing:              { bg: 'bg-red-50',     text: 'text-red-700',    icon: AlertCircle,  label: 'Missing' },
  needs_confirmation:   { bg: 'bg-blue-50',    text: 'text-blue-700',   icon: HelpCircle,   label: 'Confirm' },
};

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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => {
    const cats = new Set<string>();
    for (const r of requirements) {
      if (r.status === 'missing' || r.status === 'needs_confirmation') {
        cats.add(r.category);
      }
    }
    return cats;
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [tooltipReq, setTooltipReq] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const categories = Array.from(new Set(localReqs.map((r) => r.category)));

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const persistWidget = useCallback((reqs: TemplateRequirement[]) => {
    if (!messageId || !initiativeId) return;
    const updatedSummary = {
      total: reqs.length,
      supported: reqs.filter((r) => r.status === 'supported').length,
      partial: reqs.filter((r) => r.status === 'partially_supported').length,
      missing: reqs.filter((r) => r.status === 'missing').length,
      needs_confirmation: reqs.filter((r) => r.status === 'needs_confirmation').length,
    };
    const widgetData = { ...data, requirements: reqs, summary: updatedSummary };
    api.updateMessageWidget(initiativeId, messageId, widgetData).catch(() => {});
    onRecalculated?.(widgetData);
  }, [messageId, initiativeId, data, onRecalculated]);

  const startEdit = (req: TemplateRequirement) => {
    setEditingId(req.id);
    setEditValue(req.value || '');
  };

  const commitEdit = (reqId: string) => {
    setLocalReqs((prev) => {
      const updated = prev.map((r) =>
        r.id === reqId
          ? { ...r, value: editValue || null, status: editValue ? 'supported' : 'missing' }
          : r,
      );
      persistWidget(updated);
      return updated;
    });
    setEditingId(null);
  };

  const confirmValue = (reqId: string) => {
    setLocalReqs((prev) => {
      const updated = prev.map((r) =>
        r.id === reqId ? { ...r, status: 'supported' } : r,
      );
      persistWidget(updated);
      return updated;
    });
  };

  const investigate = (label: string) => {
    const text = `What is the ${label} for this project? Please research and propose a value.`;
    window.dispatchEvent(new CustomEvent('nitrogen:draft', { detail: { text, label } }));
  };

  const currentSummary = {
    total: localReqs.length,
    supported: localReqs.filter((r) => r.status === 'supported').length,
    partial: localReqs.filter((r) => r.status === 'partially_supported').length,
    missing: localReqs.filter((r) => r.status === 'missing').length,
    needs_confirmation: localReqs.filter((r) => r.status === 'needs_confirmation').length,
  };

  const [generating, setGenerating] = useState(false);

  const readyToGenerate = currentSummary.missing === 0;

  const handleGenerate = useCallback(async () => {
    if (onGenerate) {
      onGenerate();
      return;
    }
    if (!templateId || !initiativeId) return;
    setGenerating(true);
    try {
      const result = await api.generateFromTemplate(initiativeId, templateId, localReqs);
      window.dispatchEvent(
        new CustomEvent('nitrogen:draft', {
          detail: {
            text: `The template has been filled and saved as ${result.filename}. You can download it using the export button.`,
            label: 'generate',
          },
        }),
      );
    } catch (err) {
      console.error('Template generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [onGenerate, templateId, initiativeId, localReqs]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-stroke-subtle">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary truncate">{filename}</h3>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-green-600 font-medium">{currentSummary.supported} supported</span>
          {currentSummary.partial > 0 && (
            <span className="text-amber-600 font-medium">{currentSummary.partial} partial</span>
          )}
          <span className="text-red-600 font-medium">{currentSummary.missing} missing</span>
          {currentSummary.needs_confirmation > 0 && (
            <span className="text-blue-600 font-medium">{currentSummary.needs_confirmation} to confirm</span>
          )}
          <span className="text-text-tertiary ml-auto">{currentSummary.total} total</span>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
            style={{ width: `${currentSummary.total > 0 ? ((currentSummary.supported + currentSummary.partial) / currentSummary.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Requirements list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {categories.map((cat) => {
          const catReqs = localReqs.filter((r) => r.category === cat);
          const expanded = expandedCategories.has(cat);
          return (
            <div key={cat} className="mb-2">
              <button
                type="button"
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-2 py-2 text-left"
              >
                {expanded ? (
                  <ChevronDown className="w-3 h-3 text-text-tertiary" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-text-tertiary" />
                )}
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {cat}
                </span>
                <span className="text-[10px] text-text-tertiary">({catReqs.length})</span>
              </button>

              {expanded && (
                <div className="space-y-1 ml-5">
                  {catReqs.map((req) => {
                    const cfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.missing;
                    const Icon = cfg.icon;
                    const isEditing = editingId === req.id;

                    return (
                      <div
                        key={req.id}
                        className="group rounded-lg border border-stroke-subtle p-2.5 hover:border-stroke-muted transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.text}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-text-primary truncate">
                                {req.label}
                              </span>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
                                {cfg.label}
                              </span>
                              {req.is_calculated && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                                  Calculated
                                </span>
                              )}
                            </div>

                            <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">
                              {req.description}
                            </p>

                            {/* Value display / edit */}
                            {isEditing ? (
                              <div className="mt-1.5 flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit(req.id);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  className="flex-1 text-xs px-2 py-1 border border-accent/40 rounded focus:outline-none focus:ring-1 focus:ring-accent"
                                  placeholder="Enter value..."
                                />
                                <button
                                  type="button"
                                  onClick={() => commitEdit(req.id)}
                                  className="text-[10px] font-medium text-accent hover:underline"
                                >
                                  Save
                                </button>
                              </div>
                            ) : req.value ? (
                              <div
                                className="mt-1 relative"
                                onMouseEnter={() => setTooltipReq(req.id)}
                                onMouseLeave={() => setTooltipReq(null)}
                              >
                                <span className="text-xs font-medium text-text-primary bg-surface-subtle px-2 py-0.5 rounded inline-flex items-center gap-1">
                                  {req.value}
                                  {req.sources.length > 0 && (
                                    <sup className="text-[9px] text-accent font-bold">[{req.sources.length}]</sup>
                                  )}
                                </span>

                                {/* Citation tooltip */}
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
                            ) : null}

                            {/* Actions */}
                            <div className="mt-1.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {req.status === 'missing' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(req)}
                                    className="text-[10px] font-medium text-text-secondary hover:text-text-primary flex items-center gap-0.5"
                                  >
                                    <Pencil className="w-2.5 h-2.5" /> Enter value
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => investigate(req.label)}
                                    className="text-[10px] font-medium text-accent hover:underline flex items-center gap-0.5"
                                  >
                                    <Search className="w-2.5 h-2.5" /> Investigate
                                  </button>
                                </>
                              )}
                              {req.status === 'needs_confirmation' && req.value && (
                                <button
                                  type="button"
                                  onClick={() => confirmValue(req.id)}
                                  className="text-[10px] font-medium text-green-600 hover:underline flex items-center gap-0.5"
                                >
                                  <CheckCircle2 className="w-2.5 h-2.5" /> Confirm
                                </button>
                              )}
                              {(req.status === 'supported' || req.status === 'partially_supported') && (
                                <button
                                  type="button"
                                  onClick={() => startEdit(req)}
                                  className="text-[10px] font-medium text-text-tertiary hover:text-text-secondary flex items-center gap-0.5"
                                >
                                  <Pencil className="w-2.5 h-2.5" /> Edit
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-stroke-subtle">
        <button
          type="button"
          disabled={!isActive || generating}
          onClick={handleGenerate}
          className={[
            'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors',
            readyToGenerate
              ? 'bg-accent text-white hover:bg-accent/90'
              : 'bg-accent/60 text-white/80 cursor-default',
          ].join(' ')}
        >
          {generating ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {generating
            ? 'Generating...'
            : readyToGenerate
              ? 'Generate Document'
              : `Generate (${currentSummary.missing} missing)`}
        </button>
      </div>
    </div>
  );
}

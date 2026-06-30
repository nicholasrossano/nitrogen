'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clipboard, Loader2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import type { WorkspaceWidgetProps } from '@/lib/widgetRegistry';

const RATING_STYLES: Record<string, string> = {
  Low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Moderate: 'bg-amber-50 text-amber-700 border-amber-200',
  Substantial: 'bg-orange-50 text-orange-700 border-orange-200',
  High: 'bg-red-50 text-red-700 border-red-200',
};

const RATING_OPTIONS = ['Low', 'Moderate', 'Substantial', 'High'];

interface RiskRegisterRow {
  risk_id: string;
  category: string;
  risk_title: string;
  description?: string;
  affected_components?: string;
  inherent_rating?: string;
  mitigation?: string;
  residual_rating?: string;
  owner_status?: string;
  basis_evidence?: string;
  missing_information?: string;
  rating_rationale?: string;
}

interface CategoryRating {
  category: string;
  rating: string;
  rationale?: string;
}

interface TopRisk {
  risk_id?: string;
  risk_title?: string;
  why_it_matters?: string;
  mitigation_summary?: string;
}

interface UnresolvedIssue {
  risk_id?: string;
  issue?: string;
}

function buildMarkdown(rows: RiskRegisterRow[]): string {
  const headers = ['Risk ID', 'Category', 'Risk', 'Inherent', 'Mitigation', 'Residual', 'Owner / Status', 'Missing Info'];
  const body = rows.map((row) => [
    row.risk_id,
    row.category,
    row.risk_title,
    row.inherent_rating,
    row.mitigation,
    row.residual_rating,
    row.owner_status,
    row.missing_information,
  ]);
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...body.map((cells) => `| ${cells.map(cleanMarkdownCell).join(' | ')} |`),
  ].join('\n');
}

function buildTsv(rows: RiskRegisterRow[]): string {
  const keys: Array<keyof RiskRegisterRow> = [
    'risk_id',
    'category',
    'risk_title',
    'description',
    'affected_components',
    'inherent_rating',
    'mitigation',
    'residual_rating',
    'owner_status',
    'basis_evidence',
    'missing_information',
  ];
  return [
    keys.join('\t'),
    ...rows.map((row) => keys.map((key) => String(row[key] ?? '').replace(/\t|\n/g, ' ')).join('\t')),
  ].join('\n');
}

function cleanMarkdownCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function RatingBadge({ rating }: { rating?: string }) {
  const label = RATING_OPTIONS.includes(String(rating)) ? String(rating) : 'Moderate';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_STYLES[label]}`}>
      {label}
    </span>
  );
}

function EditableText({
  value,
  onCommit,
  multiline = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleBlur = () => {
    if (localValue !== value) {
      onCommit(localValue);
    }
  };

  if (multiline) {
    return (
      <textarea
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={handleBlur}
        rows={3}
        className="w-full min-w-[220px] rounded border border-divider bg-surface px-2 py-1.5 text-xs leading-relaxed text-text-primary outline-none focus:border-accent/60"
      />
    );
  }

  return (
    <input
      value={localValue}
      onChange={(event) => setLocalValue(event.target.value)}
      onBlur={handleBlur}
      className="w-full min-w-[160px] rounded border border-divider bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent/60"
    />
  );
}

export function RiskRegisterResultsWidget({
  data: initialData,
  projectId,
  instanceId,
  workflowVersion,
  onWorkflowUpdated,
}: WorkspaceWidgetProps) {
  const [data, setData] = useState<Record<string, any>>(initialData ?? {});
  const [activeView, setActiveView] = useState<'register' | 'categories' | 'issues'>('register');
  const [saving, setSaving] = useState(false);
  const [copyState, setCopyState] = useState<string | null>(null);

  useEffect(() => {
    setData(initialData ?? {});
  }, [initialData]);

  const rows = useMemo<RiskRegisterRow[]>(() => data.risk_register ?? [], [data.risk_register]);
  const categoryRatings = useMemo<CategoryRating[]>(() => data.category_ratings ?? [], [data.category_ratings]);
  const topRisks = useMemo<TopRisk[]>(() => data.top_risks ?? [], [data.top_risks]);
  const unresolvedIssues = useMemo<UnresolvedIssue[]>(() => data.unresolved_issues ?? [], [data.unresolved_issues]);

  const persist = useCallback(async (nextData: Record<string, any>) => {
    if (!instanceId) return;
    setSaving(true);
    try {
      await api.persistAssessmentWorkflowWidget(instanceId, nextData, workflowVersion);
      onWorkflowUpdated?.();
    } finally {
      setSaving(false);
    }
  }, [instanceId, onWorkflowUpdated, workflowVersion]);

  const commitRow = useCallback((index: number, patch: Partial<RiskRegisterRow>) => {
    setData((prev) => {
      const nextRows = [...(prev.risk_register ?? [])];
      nextRows[index] = { ...nextRows[index], ...patch };
      const next = {
        ...prev,
        risk_register: nextRows,
        copy: {
          markdown: buildMarkdown(nextRows),
          tsv: buildTsv(nextRows),
        },
      };
      void persist(next);
      return next;
    });
  }, [persist]);

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopyState(label);
    window.setTimeout(() => setCopyState(null), 1400);
  };

  const markdown = data.copy?.markdown ?? buildMarkdown(rows);
  const tsv = data.copy?.tsv ?? buildTsv(rows);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-divider px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Risk Assessment</p>
            <h3 className="mt-1 text-base font-semibold text-text-primary">
              {data.project_title || 'Project Risk Assessment'}
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-text-secondary">
              Review the generated ratings and register rows. Edits are saved back into the assessment output before export.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {saving && (
              <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </span>
            )}
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              onClick={() => copyText('markdown', markdown)}
            >
              {copyState === 'markdown' ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              Copy Markdown
            </button>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              onClick={() => copyText('tsv', tsv)}
            >
              {copyState === 'tsv' ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              Copy TSV
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(['register', 'categories', 'issues'] as const).map((view) => (
            <button
              key={view}
              type="button"
              className={`btn-secondary !px-3 !py-1.5 text-xs ${activeView === view ? 'border-accent text-accent' : ''}`}
              onClick={() => setActiveView(view)}
            >
              {view === 'register' ? 'Register' : view === 'categories' ? 'Category Ratings' : 'Top Risks & Gaps'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeView === 'register' && (
          <div className="min-w-[1180px]">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-surface-subtle">
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                  <th className="border-b border-divider px-3 py-2 font-semibold">ID</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Category</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Risk</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Inherent</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Mitigation</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Residual</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Owner / Status</th>
                  <th className="border-b border-divider px-3 py-2 font-semibold">Evidence / Gaps</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.risk_id || index} className="align-top odd:bg-surface even:bg-surface-subtle/40">
                    <td className="border-b border-divider px-3 py-3 font-mono text-[11px] text-text-secondary">{row.risk_id}</td>
                    <td className="border-b border-divider px-3 py-3">
                      <EditableText value={row.category ?? ''} onCommit={(value) => commitRow(index, { category: value })} />
                    </td>
                    <td className="border-b border-divider px-3 py-3">
                      <EditableText value={row.risk_title ?? ''} onCommit={(value) => commitRow(index, { risk_title: value })} multiline />
                      <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">{row.description}</p>
                    </td>
                    <td className="border-b border-divider px-3 py-3">
                      <select
                        value={row.inherent_rating ?? 'Moderate'}
                        onChange={(event) => commitRow(index, { inherent_rating: event.target.value })}
                        className="rounded border border-divider bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/60"
                      >
                        {RATING_OPTIONS.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                      </select>
                    </td>
                    <td className="border-b border-divider px-3 py-3">
                      <EditableText value={row.mitigation ?? ''} onCommit={(value) => commitRow(index, { mitigation: value })} multiline />
                    </td>
                    <td className="border-b border-divider px-3 py-3">
                      <select
                        value={row.residual_rating ?? 'Moderate'}
                        onChange={(event) => commitRow(index, { residual_rating: event.target.value })}
                        className="rounded border border-divider bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/60"
                      >
                        {RATING_OPTIONS.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                      </select>
                    </td>
                    <td className="border-b border-divider px-3 py-3">
                      <EditableText value={row.owner_status ?? ''} onCommit={(value) => commitRow(index, { owner_status: value })} />
                    </td>
                    <td className="border-b border-divider px-3 py-3">
                      <p className="text-[11px] leading-relaxed text-text-secondary">{row.basis_evidence}</p>
                      {row.missing_information && (
                        <p className="mt-2 flex gap-1 text-[11px] leading-relaxed text-amber-700">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {row.missing_information}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="p-6 text-sm text-text-tertiary">No risks were generated for this register.</p>
            )}
          </div>
        )}

        {activeView === 'categories' && (
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {categoryRatings.map((category) => (
              <div key={category.category} className="rounded-lg border border-divider bg-surface-subtle p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-text-primary">{category.category}</h4>
                  <RatingBadge rating={category.rating} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-text-secondary">{category.rationale}</p>
              </div>
            ))}
          </div>
        )}

        {activeView === 'issues' && (
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <section>
              <h4 className="mb-3 text-sm font-semibold text-text-primary">Top Risks</h4>
              <div className="space-y-3">
                {topRisks.map((risk, index) => (
                  <div key={`${risk.risk_id}-${index}`} className="rounded-lg border border-divider bg-surface-subtle p-4">
                    <p className="text-xs font-semibold text-text-primary">{risk.risk_id} {risk.risk_title}</p>
                    <p className="mt-2 text-xs leading-relaxed text-text-secondary">{risk.why_it_matters}</p>
                    {risk.mitigation_summary && (
                      <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">{risk.mitigation_summary}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h4 className="mb-3 text-sm font-semibold text-text-primary">Unresolved Issues</h4>
              <div className="space-y-3">
                {unresolvedIssues.map((issue, index) => (
                  <div key={`${issue.risk_id}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-semibold text-amber-800">{issue.risk_id || 'Open issue'}</p>
                    <p className="mt-2 text-xs leading-relaxed text-amber-800">{issue.issue}</p>
                  </div>
                ))}
                {unresolvedIssues.length === 0 && (
                  <p className="text-xs text-text-tertiary">No unresolved issues were identified.</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

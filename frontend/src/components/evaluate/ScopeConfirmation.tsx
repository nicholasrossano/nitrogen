'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, HelpCircle, Loader2, FileText, X } from 'lucide-react';
import type { ScopeFact, ScopeFactSource } from '@/lib/api';

// ── Field type config ────────────────────────────────────────────────

type FieldType = 'yes_no' | 'select' | 'text' | 'multi_select' | 'category_select';

interface FieldConfig {
  type: FieldType;
  label?: string;
  options?: string[];
  option_descriptions?: Record<string, string>;
  placeholder?: string;
}

const FIELD_CONFIG: Record<string, FieldConfig> = {
  // IFC PS
  project_category:    { label: 'Project Category', type: 'category_select', options: ['A', 'B', 'C', 'FI'],
                         option_descriptions: { A: 'High risk — significant adverse E&S impacts', B: 'Medium risk — limited adverse impacts', C: 'Minimal or no risk', FI: 'Financial intermediary' } },
  financing_sources:   { label: 'Financing Sources', type: 'multi_select', options: ['IFC', 'MIGA', 'Other DFI co-financier', 'Commercial bank', 'Equity'] },
  supply_chain_risk:   { label: 'Supply Chain Labor Risk', type: 'yes_no' },
  significant_ghg:     { label: 'Significant GHG Emissions Expected', type: 'yes_no' },

  // World Bank ESF
  risk_classification: { label: 'Risk Classification', type: 'category_select', options: ['High', 'Substantial', 'Moderate', 'Low'],
                         option_descriptions: { High: 'Full ESS1-ESS10 apply', Substantial: 'ESS1-ESS8 + ESS10', Moderate: 'ESS1-ESS4 + ESS10', Low: 'ESS1 + ESS10 only' } },
  instrument_type:     { label: 'Financing Instrument', type: 'select', options: ['IPF', 'DPF', 'PforR'] },
  sovereign_borrower:  { label: 'Sovereign / Government Borrower', type: 'yes_no' },
  financial_intermediary: { label: 'Lending Through Financial Intermediaries', type: 'yes_no' },

  // EP4
  ep_category:         { label: 'EP Project Category', type: 'category_select', options: ['A', 'B', 'C'],
                         option_descriptions: { A: 'Significant adverse E&S impacts — full EP apply', B: 'Limited adverse impacts — reduced scope', C: 'Minimal or no impacts — Principle 1 only' } },
  financing_type:      { label: 'Financing Type', type: 'select', options: ['Project Finance', 'Project-Related Corporate Loan', 'Bridge Loan', 'Advisory'] },
  designated_country:  { label: 'Project in an EP Designated Country', type: 'yes_no' },
  conflict_affected:   { label: 'Conflict-Affected or High-Risk Area', type: 'yes_no' },

  // Verra VCS
  vcs_methodology:     { label: 'VCS Methodology ID', type: 'text', placeholder: 'e.g. VM0015' },
  activity_type:       { label: 'Activity Type', type: 'select', options: ['Renewable Energy', 'Energy Efficiency', 'AFOLU', 'Waste', 'Transport', 'Other'] },
  afolu_project:       { label: 'AFOLU Project (triggers non-permanence buffer)', type: 'yes_no' },
  grouped_project:     { label: 'Grouped Project', type: 'yes_no' },
  crediting_period_type: { label: 'Crediting Period Type', type: 'select', options: ['7-year renewable', '10-year fixed'] },

  // Gold Standard
  gs_activity_type:    { label: 'Activity Type', type: 'select', options: ['Renewable Energy', 'Energy Efficiency', 'Clean Cookstoves', 'Water', 'Waste', 'Other'] },
  sdg_targets:         { label: 'Targeted SDGs Beyond SDG 13', type: 'text', placeholder: 'e.g. SDG 7, SDG 15' },
  microscale:          { label: 'Microscale Project (simplified rules)', type: 'yes_no' },
  retroactive_crediting: { label: 'Retroactive Crediting Sought', type: 'yes_no' },

  // ASTM Phase I
  property_type:       { label: 'Property Type', type: 'select', options: ['Commercial', 'Industrial', 'Residential', 'Undeveloped', 'Mixed-use'] },
  transaction_type:    { label: 'Transaction Type', type: 'select', options: ['Acquisition', 'Refinancing', 'Foreclosure', 'Other'] },
  prior_phase1_exists: { label: 'Prior Phase I ESA Exists', type: 'yes_no' },
  known_contamination: { label: 'Known Contamination on Site', type: 'yes_no' },

  // Legacy / shared
  financing_source:    { label: 'Financing Source or Lender Type', type: 'select',
    options: [
      'IFC / MIGA financing', 'World Bank / IBRD / IDA lending', 'Equator Principles signatory bank',
      'Other DFI (e.g. ADB, EBRD, AfDB)', 'Commercial bank (non-EP)', 'Equity / grant only',
      'Not yet determined', 'Other',
    ],
    placeholder: 'Select financing source…',
  },
  sovereign_financing:  { label: 'Sovereign / Government Borrower Involvement', type: 'yes_no' },
  carbon_intent:        { label: 'Carbon Credit Certification Intent', type: 'yes_no' },
  land_acquisition:     { label: 'Land Acquisition or Resettlement Involvement', type: 'yes_no' },
  indigenous_peoples:   { label: 'Indigenous Peoples Interface', type: 'yes_no' },
  us_site_transaction:  { label: 'U.S. Site / Property Transaction', type: 'yes_no' },
  biodiversity:         { label: 'Proximity to Protected Areas or Critical Habitats', type: 'yes_no' },
  cultural_heritage:    { label: 'Cultural Heritage Presence', type: 'yes_no' },
  high_ghg:             { label: 'Significant GHG Emissions Expected', type: 'yes_no' },
  conflict_area:        { label: 'Conflict-Affected or High-Risk Area', type: 'yes_no' },
};

// ── Helpers ───────────────────────────────────────────────────────────

const SENTINELS = new Set(['auto', 'needs_confirmation', 'unknown', 'n/a', '']);

function sanitize(v: string): string {
  return SENTINELS.has((v ?? '').toLowerCase().trim()) ? '' : v;
}

function hasGroundedSources(fact: ScopeFact): boolean {
  return !!fact.sources && fact.sources.length > 0;
}

function parseMultiValue(v: string): string[] {
  if (!v) return [];
  try { const arr = JSON.parse(v); if (Array.isArray(arr)) return arr; } catch { /* not JSON */ }
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function serializeMultiValue(arr: string[]): string {
  return JSON.stringify(arr);
}

// ── Status badge config ──────────────────────────────────────────────

const STATUS = {
  confirmed:      { bg: 'bg-green-50',  text: 'text-green-700',  Icon: CheckCircle2, label: 'Confirmed' },
  auto_detected:  { bg: 'bg-green-50',  text: 'text-green-700',  Icon: CheckCircle2, label: 'Auto-detected' },
  needs_input:    { bg: 'bg-amber-50',  text: 'text-amber-700',  Icon: HelpCircle,   label: 'Needs input' },
};

// ── Sources panel ────────────────────────────────────────────────────

function SourcesPanel({ fact, onClose }: { fact: ScopeFact; onClose: () => void }) {
  const sources = fact.sources ?? [];

  return (
    <div className="w-[340px] border-l border-divider h-full flex flex-col bg-white shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
        <h4 className="text-xs font-semibold text-text-primary">Sources</h4>
        <button onClick={onClose} className="icon-btn p-1 text-text-tertiary">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Fact</p>
          <p className="text-xs text-text-primary font-medium">{fact.label}</p>
          {fact.value && <p className="text-xs text-text-secondary">Value: {fact.value}</p>}
        </div>

        {fact.source_quote && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">LLM Quote</p>
            <blockquote className="text-[11px] text-text-secondary italic border-l-2 border-divider pl-2.5 leading-relaxed">
              &ldquo;{fact.source_quote}&rdquo;
            </blockquote>
          </div>
        )}

        {sources.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Evidence ({sources.length})
            </p>
            {sources.map((src, i) => (
              <SourceCard key={i} source={src} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-text-tertiary py-4 text-center">
            No supporting evidence found in project documents.
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: ScopeFactSource }) {
  return (
    <div className="border border-stroke-subtle rounded-lg px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <FileText className="w-3 h-3 text-text-tertiary shrink-0" />
        <span className="text-[11px] font-medium text-text-primary truncate">{source.source_title}</span>
        <span className="text-[9px] text-text-tertiary ml-auto shrink-0">
          {Math.round(source.similarity * 100)}% match
        </span>
      </div>
      <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-4">{source.content}</p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

interface ScopeConfirmationProps {
  facts: ScopeFact[];
  frameworkName: string;
  onRun: (confirmedFacts: ScopeFact[]) => void;
  running?: boolean;
  isRerun?: boolean;
}

export function ScopeConfirmation({ facts, frameworkName, onRun, running, isRerun }: ScopeConfirmationProps) {
  const [editableFacts, setEditableFacts] = useState<ScopeFact[]>(() =>
    facts.map((f) => {
      const cleanValue = sanitize(f.value);
      const isAutoGrounded = f.source === 'auto' && cleanValue !== '' && hasGroundedSources(f);
      return { ...f, value: cleanValue, confirmed: isAutoGrounded };
    })
  );

  const [inspectingFactId, setInspectingFactId] = useState<string | null>(null);

  const setValue = useCallback((id: string, value: string, autoConfirm = false) => {
    setEditableFacts((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, value, confirmed: autoConfirm || f.confirmed } : f
      )
    );
  }, []);

  const confirm = useCallback((id: string) => {
    setEditableFacts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, confirmed: true } : f))
    );
  }, []);

  const pendingCount = editableFacts.filter((f) => !f.confirmed).length;
  const allConfirmed = pendingCount === 0;
  const inspectedFact = inspectingFactId ? editableFacts.find((f) => f.id === inspectingFactId) : null;

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-1 pb-3">
          <h3 className="text-sm font-semibold text-text-primary">
            {isRerun ? 'Update Scope' : 'Scope Confirmation'}
          </h3>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">
            {isRerun
              ? `Update the scope facts below and rerun the pre-check against ${frameworkName}. Changes will produce a versioned comparison.`
              : `Review the facts below before running the pre-check against ${frameworkName}. Auto-detected facts are grounded in project documents — click Sources to view evidence.`}
          </p>
        </div>

        {/* Fact tiles */}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {editableFacts.map((fact) => {
            const cfg = FIELD_CONFIG[fact.id] ?? { type: 'text' as const };
            const isAutoGrounded = fact.source === 'auto' && !!fact.value && hasGroundedSources(fact);

            let statusKey: keyof typeof STATUS;
            if (fact.confirmed) {
              statusKey = isAutoGrounded ? 'auto_detected' : 'confirmed';
            } else {
              statusKey = 'needs_input';
            }

            const { bg, text, Icon, label } = STATUS[statusKey];
            const hasSources = hasGroundedSources(fact);
            const isInspecting = inspectingFactId === fact.id;

            return (
              <div
                key={fact.id}
                className={`rounded-lg border transition-colors ${
                  isInspecting
                    ? 'border-accent/40 bg-accent-wash/20'
                    : fact.confirmed
                      ? 'border-stroke-subtle bg-white'
                      : 'border-amber-200 bg-amber-50/40'
                }`}
              >
                {/* Tile header */}
                <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1.5">
                  <span className="text-xs font-medium text-text-primary leading-snug">
                    {cfg.label ?? fact.label}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasSources && (
                      <button
                        type="button"
                        onClick={() => setInspectingFactId(isInspecting ? null : fact.id)}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 transition-colors ${
                          isInspecting
                            ? 'bg-accent/10 text-accent'
                            : 'bg-surface-subtle text-text-tertiary hover:text-text-secondary'
                        }`}
                      >
                        <FileText className="w-2.5 h-2.5" />
                        Sources
                      </button>
                    )}
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${bg} ${text}`}>
                      <Icon className="w-3 h-3" />
                      {label}
                    </span>
                  </div>
                </div>

                {/* Input area */}
                <div className="px-4 pb-3">
                  {/* Yes / No toggle */}
                  {cfg.type === 'yes_no' && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {(['Yes', 'No'] as const).map((opt) => {
                        const isSelected = fact.value === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { setValue(fact.id, opt); confirm(fact.id); }}
                            className={`text-[11px] font-medium px-3 py-1 rounded-md border transition-colors ${
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

                  {/* Dropdown select */}
                  {cfg.type === 'select' && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <select
                        value={fact.value}
                        onChange={(e) => { setValue(fact.id, e.target.value); confirm(fact.id); }}
                        className="flex-1 text-xs px-2.5 py-1.5 border border-stroke-subtle rounded bg-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 text-text-primary"
                      >
                        <option value="">{cfg.placeholder ?? 'Select…'}</option>
                        {cfg.options?.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Multi-select toggle pills */}
                  {cfg.type === 'multi_select' && (() => {
                    const selected = parseMultiValue(fact.value);
                    return (
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {cfg.options?.map((opt) => {
                          const isSelected = selected.includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                const next = isSelected
                                  ? selected.filter(s => s !== opt)
                                  : [...selected, opt];
                                const serialized = serializeMultiValue(next);
                                setValue(fact.id, serialized);
                                if (next.length > 0) confirm(fact.id);
                              }}
                              className={`text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                                isSelected
                                  ? 'bg-accent/10 border-accent/30 text-accent'
                                  : 'border-stroke-subtle text-text-secondary hover:border-stroke-muted'
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Category select — radio card group */}
                  {cfg.type === 'category_select' && (
                    <div className="grid gap-1.5 mt-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(cfg.options?.length ?? 2, 4)}, 1fr)` }}>
                      {cfg.options?.map((opt) => {
                        const isSelected = fact.value === opt;
                        const desc = cfg.option_descriptions?.[opt];
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { setValue(fact.id, opt); confirm(fact.id); }}
                            className={`text-left px-2.5 py-2 rounded-lg border transition-colors ${
                              isSelected
                                ? 'bg-accent/10 border-accent/30 ring-1 ring-accent/20'
                                : 'border-stroke-subtle hover:border-stroke-muted'
                            }`}
                          >
                            <span className={`text-xs font-semibold block ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                              {opt}
                            </span>
                            {desc && (
                              <span className="text-[10px] text-text-tertiary leading-tight mt-0.5 block">
                                {desc}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Free text */}
                  {cfg.type === 'text' && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <input
                        type="text"
                        value={fact.value}
                        onChange={(e) => setValue(fact.id, e.target.value)}
                        placeholder={cfg.placeholder ?? 'Enter value…'}
                        className="flex-1 text-xs px-2.5 py-1.5 border border-stroke-subtle rounded bg-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 text-text-primary placeholder:text-text-tertiary"
                      />
                      {!fact.confirmed && (
                        <button
                          type="button"
                          onClick={() => confirm(fact.id)}
                          className="btn-primary !text-xs !px-3 !py-1 shrink-0"
                        >
                          Confirm
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer action bar */}
        <div className="pt-3 mt-2 flex items-center justify-between">
          <p className="text-[10px] text-text-tertiary">
            {allConfirmed
              ? `${editableFacts.length} facts confirmed · ready to run`
              : `${pendingCount} fact${pendingCount !== 1 ? 's' : ''} still need${pendingCount === 1 ? 's' : ''} input`}
          </p>
          <button
            onClick={() => onRun(editableFacts)}
            disabled={!allConfirmed || running}
            className="btn-primary !text-xs !px-4 !py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {isRerun ? 'Rerunning…' : 'Running…'}
              </>
            ) : (
              isRerun ? 'Update & Rerun' : 'Run Pre-Check'
            )}
          </button>
        </div>
      </div>

      {/* Sources side panel */}
      {inspectedFact && (
        <SourcesPanel
          fact={inspectedFact}
          onClose={() => setInspectingFactId(null)}
        />
      )}
    </div>
  );
}

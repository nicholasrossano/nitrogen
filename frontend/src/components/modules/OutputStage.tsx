'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, FileText, AlertCircle, Download } from 'lucide-react';
import type { WorkflowOutput, BuildLayerDef, WorkflowBuild } from '@/lib/api';
import { api } from '@/lib/api';
import { coerceDisplayString } from './renderUtils';

interface OutputStageProps {
  instanceId: string;
  output: WorkflowOutput;
  build: WorkflowBuild;
  layerDefs: BuildLayerDef[];
  onStateUpdated: () => void;
}

function normalizeSectionContent(raw: unknown): string | string[] | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    return raw.trim() === '' ? null : raw;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return raw.map((item) => coerceDisplayString(item));
  }
  const single = coerceDisplayString(raw);
  return single === '' ? null : single;
}

function OutputSection({ title, content: raw }: { title: string; content: unknown }) {
  const content = normalizeSectionContent(raw);
  if (!content) return null;

  return (
    <div className="mb-5">
      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{title}</h4>
      {Array.isArray(content) ? (
        <ul className="space-y-1.5">
          {content.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-text-primary">
              <span className="text-text-tertiary mt-0.5 shrink-0">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{content}</p>
      )}
    </div>
  );
}

function CitationsSection({ citations }: { citations: Array<Record<string, any>> }) {
  if (!citations?.length) return null;
  return (
    <div className="mb-5">
      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">References</h4>
      <ol className="space-y-2 min-w-0">
        {citations.map((c, idx) => (
          <li key={coerceDisplayString(c.number) || idx} className="flex gap-2 text-xs text-text-secondary min-w-0">
            <span className="shrink-0 font-medium text-text-tertiary">[{coerceDisplayString(c.number)}]</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-text-primary break-words">
                {coerceDisplayString(c.source_title)}
              </span>
              {c.publisher != null && String(coerceDisplayString(c.publisher)) !== '' && (
                <span className="text-text-tertiary break-words"> — {coerceDisplayString(c.publisher)}</span>
              )}
              {typeof c.source_url === 'string' && c.source_url && (
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-accent hover:underline mt-0.5 break-all"
                >
                  {c.source_url}
                </a>
              )}
              {c.excerpt != null && String(coerceDisplayString(c.excerpt)) !== '' && (
                <span className="block text-text-tertiary mt-0.5 italic line-clamp-2 break-words">
                  &ldquo;{coerceDisplayString(c.excerpt)}&rdquo;
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DocumentViewer({ content }: { content: Record<string, any> }) {
  const {
    title, executive_summary, sections,
    landscape_overview, key_actor_analysis, strategic_implications,
    recommendations, stakeholder_map, engagement_strategy,
    engagement_recommendations, risk_considerations, error,
    ...rest
  } = content;

  if (error) {
    return (
      <div className="flex items-start gap-2 text-red-400 text-sm p-3 bg-red-500/10 border border-red-500/20 rounded">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {title && (
        <h3 className="text-base font-semibold text-text-primary mb-4">{title}</h3>
      )}
      <OutputSection title="Executive Summary" content={executive_summary} />

      {/* Theme / category sections (new output format) */}
      {Array.isArray(sections) && sections.map((sec: any, i: number) => (
        <OutputSection
          key={i}
          title={sec.theme ?? sec.category ?? `Section ${i + 1}`}
          content={sec.body ?? sec.content ?? ''}
        />
      ))}

      {/* Legacy / fallback fields */}
      <OutputSection title="Landscape Overview" content={landscape_overview} />
      <OutputSection title="Stakeholder Map" content={stakeholder_map} />
      <OutputSection title="Key Actor Analysis" content={key_actor_analysis} />
      <OutputSection title="Strategic Implications" content={strategic_implications} />
      <OutputSection title="Engagement Strategy" content={engagement_strategy} />
      <OutputSection title="Engagement Recommendations" content={engagement_recommendations} />
      <OutputSection title="Recommendations & Next Steps" content={recommendations} />
      <OutputSection title="Risk Considerations" content={risk_considerations} />

      {/* Any remaining scalar fields */}
      {Object.entries(rest).map(([key, val]) => {
        if (key === 'citations' || val === null || val === undefined) return null;
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return <OutputSection key={key} title={label} content={val} />;
      })}

      <CitationsSection citations={content.citations} />
    </div>
  );
}

export function OutputStage({
  instanceId,
  output,
  build,
  layerDefs,
  onStateUpdated,
}: OutputStageProps) {
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoGenTriggered = useRef(false);

  // Gate on any items existing in the final layer (category-confirm flow doesn't
  // set individual item.confirmed, so we just check items.length > 0)
  const lastLayerDef = layerDefs[layerDefs.length - 1];
  const lastLayer = lastLayerDef ? build.layers[lastLayerDef.id] : null;
  const itemsInLast = (lastLayer?.items ?? []).length;
  const canGenerate = itemsInLast > 0 && output.status !== 'generating';
  const isGenerating = generating || output.status === 'generating';

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.generateWorkflowOutput(instanceId);
      onStateUpdated();
    } catch (e: any) {
      setError(e.message ?? 'Output generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.exportModuleOutputDocx(instanceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Auto-generate on first enter if eligible and no content yet
  useEffect(() => {
    if (autoGenTriggered.current) return;
    if (canGenerate && !output.content) {
      autoGenTriggered.current = true;
      handleGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate]);

  const totalItems = Object.values(build.layers).reduce(
    (acc, l) => acc + l.items.length,
    0
  );

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 flex items-center justify-between">
          <span>{error}</span>
          <button className="underline ml-2" onClick={() => { setError(null); handleGenerate(); }}>Retry</button>
        </div>
      )}

      {/* Generating spinner */}
      {isGenerating && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-tertiary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-xs">Generating assessment document…</span>
        </div>
      )}

      {/* Not yet eligible */}
      {!isGenerating && !output.content && itemsInLast === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-text-tertiary">
          <FileText className="w-5 h-5 opacity-40" />
          <p className="text-xs text-center">
            Complete the &ldquo;{lastLayerDef?.name ?? 'Details'}&rdquo; layer<br />
            to generate your output document.
          </p>
        </div>
      )}

      {/* Rendered document */}
      {!isGenerating && output.content && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-text-tertiary">
              Generated from {totalItems} item{totalItems !== 1 ? 's' : ''} across {layerDefs.length} layer{layerDefs.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="btn-primary !text-xs !px-3 !py-1.5"
            >
              {exporting ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Exporting…</>
              ) : (
                <><Download className="w-3 h-3" /> Export DOCX</>
              )}
            </button>
          </div>
          <div className="border border-stroke-subtle rounded-lg p-4 min-w-0">
            <DocumentViewer content={output.content} />
          </div>
        </>
      )}
    </div>
  );
}

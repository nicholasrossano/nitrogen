/**
 * Client-only demo chat reply: no backend, no live model.
 * Streams a sample answer with citations + a proposed-value widget
 * so visitors see what live project chat looks like.
 */

import type { SourceCitation } from '@/lib/api/types';
import { DEMO_VAR_CAPEX } from '@/lib/demo/demoFixtures';

export const DEMO_PLACEHOLDER_SOURCES: SourceCitation[] = [
  {
    source_type: 'evidence',
    source_title: 'Rift Valley Solar Feasibility Study v3',
    confidence: 0.92,
    evidence_doc_id: 'demo-mat-feasibility',
    chunk_id: 'demo-mat-feasibility-chunk-0',
    chunk_index: 12,
  },
  {
    source_type: 'evidence',
    source_title: 'KPLC PPA Term Sheet Draft',
    confidence: 0.85,
    evidence_doc_id: 'demo-mat-ppa',
    chunk_id: 'demo-mat-ppa-chunk-0',
    chunk_index: 3,
  },
  // Real World Bank Search API hit (P180465); same connector as search_comparable_projects.
  {
    source_type: 'worldbank_project',
    source_title:
      'Kenya Green and Resilient Expansion of Energy (GREEN) Program Phase 2 Project',
    source_url:
      'https://projects.worldbank.org/en/projects-operations/project-detail/P180465',
    chunk_id: 'P180465',
    confidence: 0.75,
    publisher: 'World Bank Projects & Operations',
  },
];

export const DEMO_PLACEHOLDER_WIDGET = {
  field_name: 'capex_per_kw',
  label: 'CAPEX per kW',
  current_value: 1100,
  proposed_value: 1200,
  unit: 'USD/kW',
  model_type: 'lcoe' as const,
  assessment_id: 'lcoe_model',
  variable_id: DEMO_VAR_CAPEX,
  confidence: 'high' as const,
  explanation:
    'Stress case aligned with upper-bound EPC + BESS package quotes from the feasibility study.',
  status: 'pending',
};

/** Sample assistant turn: grounded answer, citation chips, and a value proposal. */
export const DEMO_PLACEHOLDER_REPLY = [
  "Live AI chat is disabled for this demo. Here's a sample of how it would answer a real question on **Rift Valley Solar**, so you can see how citations and proposals work.",
  '',
  "You asked how sensitive LCOE is to CAPEX. Based on the feasibility study, all-in CAPEX is currently modeled at **$1,100/kW** for the PV + 4h BESS package [Evidence: Rift Valley Solar Feasibility Study v3]. If that lands closer to **$1,200/kW**, holding 22% capacity factor and 8% WACC steady, LCOE rises from about **$0.054/kWh to ~$0.058/kWh**, roughly **7-8%** higher. That still clears the **$0.072/kWh** PPA tariff in the draft term sheet [Evidence: KPLC PPA Term Sheet Draft], just with less headroom for equity returns. I've proposed updating the CAPEX input below, with a link back to the source doc.",
  '',
  "For investment committee context, the closest precedent I found is the World Bank's **Kenya Green and Resilient Expansion of Energy (GREEN) Program Phase 2** (P180465), which finances a comparable BESS for renewable integration [Comparable Project: Kenya Green and Resilient Expansion of Energy (GREEN) Program Phase 2 Project]. That chip links out to the live project page on worldbank.org.",
  '',
  "That's the pattern: answers grounded in your files, a value you can accept or dismiss, and outside research when it's useful. Sign up to run it for real.",
].join('\n');

type CompletePayload = {
  content: string;
  sources: SourceCitation[];
  tiers_used: string[];
  citation_count: number;
  latency_ms: number;
  widget_type?: string | null;
  widget_data?: Record<string, unknown> | null;
  thinking_lines?: string[];
  chat_id: string;
  user_message_id: string;
  assistant_message_id: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Mimics sendChatStream callbacks for demo mode.
 * Reuses the existing chat id when present so URL sync does not reload
 * fixture history and wipe the in-thread exchange.
 */
export async function streamDemoPlaceholderReply(options: {
  chatId?: string | null;
  onThinking: (text: string) => void;
  onWord: (word: string) => void;
  onComplete: (payload: CompletePayload) => void;
}): Promise<void> {
  const { chatId, onThinking, onWord, onComplete } = options;
  const started = Date.now();
  const thinkingLines = [
    'Pulled LCOE base case inputs from project variables',
    'Scaled CAPEX while holding CF, WACC, and O&M',
    'Cited project materials for CAPEX and PPA tariff',
    'Matched Kenya GREEN Phase 2 (P180465) as a comparable project',
  ];

  for (const line of thinkingLines) {
    onThinking(line);
    await delay(40);
  }

  const tokens = DEMO_PLACEHOLDER_REPLY.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    onWord(token);
    // Keep it snappy: enough motion to feel like a stream, not a stall.
    await delay(12);
  }

  const stamp = Date.now();
  onComplete({
    content: DEMO_PLACEHOLDER_REPLY,
    sources: DEMO_PLACEHOLDER_SOURCES,
    tiers_used: ['evidence', 'worldbank_project'],
    citation_count: DEMO_PLACEHOLDER_SOURCES.length,
    latency_ms: Date.now() - started,
    widget_type: 'proposed_value',
    widget_data: { ...DEMO_PLACEHOLDER_WIDGET },
    thinking_lines: thinkingLines,
    // Empty string when no thread yet: callers treat falsy chat_id as "stay local".
    chat_id: chatId ?? '',
    user_message_id: `demo-user-${stamp}`,
    assistant_message_id: `demo-assistant-${stamp}`,
  });
}

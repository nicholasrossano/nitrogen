import { resolveDemoRequest, DemoDisabledError } from '@/lib/demo/demoApi';
import { DEMO_PROJECT_ID, DEMO_WORKSPACE_ID } from '@/lib/demo/demoSession';
import { DEMO_CHAT_CARBON_ID, DEMO_CHAT_LCOE_ID, DEMO_CHAT_STAKEHOLDER_ID, DEMO_INSTANCE_LCOE, DEMO_INSTANCE_SOLAR, DEMO_INSTANCE_STAKEHOLDER, DEMO_VAR_CAPACITY_FACTOR } from '@/lib/demo/demoFixtures';

describe('resolveDemoRequest', () => {
  it('returns the demo workspace and project', () => {
    const workspaces = resolveDemoRequest<Array<{ id: string }>>('/api/v1/workspaces');
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe(DEMO_WORKSPACE_ID);

    const project = resolveDemoRequest<{ id: string; shared_role?: string }>(
      `/api/v1/projects/${DEMO_PROJECT_ID}`,
    );
    expect(project.id).toBe(DEMO_PROJECT_ID);
    expect(project.shared_role).toBe('viewer');
  });

  it('returns chat history and variable comments', () => {
    const chats = resolveDemoRequest<{ chats: Array<{ id: string }> }>('/api/v1/chats');
    expect(chats.chats.map((c) => c.id)).toContain(DEMO_CHAT_LCOE_ID);

    const messages = resolveDemoRequest<{ messages: unknown[] }>(
      `/api/v1/chats/${DEMO_CHAT_LCOE_ID}/messages`,
    );
    expect(messages.messages.length).toBeGreaterThan(0);

    const comments = resolveDemoRequest<unknown[]>(
      `/api/v1/variables/${DEMO_VAR_CAPACITY_FACTOR}/comments`,
    );
    expect(comments.length).toBeGreaterThan(0);
  });

  it('includes inline citation markers in the carbon demo chat', () => {
    const { messages } = resolveDemoRequest<{
      messages: Array<{ role: string; content: string; sources?: unknown[] }>;
    }>(`/api/v1/chats/${DEMO_CHAT_CARBON_ID}/messages`);
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toMatch(/\[Evidence: Rift Valley Solar Feasibility Study v3, p0\]/);
    expect(assistant?.content).toMatch(/\[Corpus: Kenya grid emission factor guidance\]/);
    expect(assistant?.sources?.length).toBeGreaterThan(0);
  });

  it('includes a World Bank comparable-project citation in the stakeholder demo chat', () => {
    const { messages } = resolveDemoRequest<{
      messages: Array<{ role: string; content: string; sources?: Array<{ source_type: string; chunk_id?: string }> }>;
    }>(`/api/v1/chats/${DEMO_CHAT_STAKEHOLDER_ID}/messages`);
    const wb = messages.find(
      (m) => m.role === 'assistant' && m.content.includes('[Comparable Project:'),
    );
    expect(wb?.content).toContain('P180465');
    expect(wb?.content).toContain('200 MWh');
    expect(wb?.sources?.[0]).toEqual(
      expect.objectContaining({
        source_type: 'worldbank_project',
        chunk_id: 'P180465',
      }),
    );
  });

  it('returns assessments associated with a demo chat', () => {
    const { assessments } = resolveDemoRequest<{
      assessments: Array<{ instance_id: string; assessment_id: string }>;
    }>(`/api/v1/chats/${DEMO_CHAT_LCOE_ID}/assessments`);
    expect(assessments).toEqual([
      expect.objectContaining({
        instance_id: DEMO_INSTANCE_LCOE,
        assessment_id: 'lcoe_model',
      }),
    ]);
  });

  it('blocks mutations', () => {
    expect(() =>
      resolveDemoRequest('/api/v1/projects', { method: 'POST', body: '{}' }),
    ).toThrow(DemoDisabledError);
  });

  it('returns evidence chunk previews for demo files', () => {
    const chunks = resolveDemoRequest<{ chunks: unknown[]; file_type: string | null }>(
      '/api/v1/evidence/demo-mat-feasibility/chunks',
    );
    expect(chunks.file_type).toBe('text');
    expect(chunks.chunks.length).toBeGreaterThan(0);
  });

  it('returns solar yield and stakeholder map workflows', () => {
    const solar = resolveDemoRequest<{
      assessment_definition: { stage_defs: Array<{ widget: string }> };
      workflow_state: { stages: { results: { data: { widget_data: { result?: { ac_annual: number } } } } } };
    }>(`/api/v1/assessment-workflow/${DEMO_INSTANCE_SOLAR}/state`);
    expect(solar.assessment_definition.stage_defs.map((s) => s.widget)).toContain('solar_yield_results');
    expect(solar.workflow_state.stages.results.data.widget_data.result?.ac_annual).toBeGreaterThan(0);

    const stakeholder = resolveDemoRequest<{
      assessment_definition: { stage_defs: Array<{ widget: string }> };
      workflow_state: { stages: { map: { data: { widget_data: { groups: unknown[] } } } } };
    }>(`/api/v1/assessment-workflow/${DEMO_INSTANCE_STAKEHOLDER}/state`);
    expect(stakeholder.assessment_definition.stage_defs.map((s) => s.widget)).toContain('assessment_map');
    expect(stakeholder.workflow_state.stages.map.data.widget_data.groups.length).toBeGreaterThan(0);
  });

  it('returns prebuilt stakeholder enrich profiles', () => {
    const enriched = resolveDemoRequest<{
      item_id: string;
      record: { notes?: string; role_in_project?: string };
    }>(`/api/v1/assessment-workflow/${DEMO_INSTANCE_STAKEHOLDER}/stakeholders/sh-nema/enrich`, {
      method: 'POST',
    });
    expect(enriched.item_id).toBe('sh-nema');
    expect(enriched.record.role_in_project).toBe('Environmental regulator');
    expect(enriched.record.notes?.length).toBeGreaterThan(40);
  });
});

import type { FloatWidget } from '@/components/editor/FloatLayer';
import {
  clearPersistedFloatSession,
  closeFloatTabInSession,
  FLOAT_TAB_HARD_CAP,
  floatTabDedupeKey,
  floatTabKeepAliveIds,
  openFloatTabInSession,
  readPersistedFloatSession,
  replaceFloatTabInSession,
  touchFloatTabRecentOrder,
  writePersistedFloatSession,
} from '@/lib/floatTabSession';

function widget(partial: Partial<FloatWidget> & Pick<FloatWidget, 'type' | 'messageId'>): FloatWidget {
  return {
    data: partial.data ?? {},
    ...partial,
  };
}

describe('floatTabSession', () => {
  it('dedupes assessment family by instance id', () => {
    expect(floatTabDedupeKey(widget({
      type: 'assessment_workspace',
      messageId: 'workspace-1',
      data: { instance_id: 'inst-1' },
    }))).toBe('assessment:inst-1');

    expect(floatTabDedupeKey(widget({
      type: 'decision_log',
      messageId: 'decision-log-1',
      data: { instance_id: 'inst-1' },
    }))).toBe('assessment:inst-1');
  });

  it('opens a new tab and activates it', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    const b = widget({ type: 'document_viewer', messageId: 'doc-b', data: { evidence_doc_id: 'b' } });

    const first = openFloatTabInSession([], null, a, []);
    expect(first.tabs).toHaveLength(1);
    expect(first.activeTabId).toBe('document:a');

    const second = openFloatTabInSession(first.tabs, first.activeTabId, b, [first.activeTabId]);
    expect(second.tabs).toHaveLength(2);
    expect(second.activeTabId).toBe('document:b');
  });

  it('activates an existing tab instead of duplicating', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    const again = widget({
      type: 'document_viewer',
      messageId: 'doc-a-2',
      data: { evidence_doc_id: 'a', title: 'Updated' },
    });
    const opened = openFloatTabInSession([a], 'document:a', again, ['document:a']);
    expect(opened.tabs).toHaveLength(1);
    expect(opened.tabs[0].data.title).toBe('Updated');
    expect(opened.activeTabId).toBe('document:a');
  });

  it('replaces the active tab for in-tab navigation', () => {
    const assessment = widget({
      type: 'assessment_workspace',
      messageId: 'workspace-1',
      data: { instance_id: 'inst-1', assessment_id: 'lcoe' },
    });
    const log = widget({
      type: 'decision_log',
      messageId: 'decision-log-1',
      data: { instance_id: 'inst-1', assessment_id: 'lcoe' },
    });
    const result = replaceFloatTabInSession([assessment], 'assessment:inst-1', log);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].type).toBe('decision_log');
    expect(result.activeTabId).toBe('assessment:inst-1');
  });

  it('closes a tab and falls back to a neighbor', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    const b = widget({ type: 'document_viewer', messageId: 'doc-b', data: { evidence_doc_id: 'b' } });
    const closed = closeFloatTabInSession([a, b], 'document:b', 'document:b');
    expect(closed.tabs).toHaveLength(1);
    expect(closed.activeTabId).toBe('document:a');
    expect(closed.closed?.messageId).toBe('doc-b');
  });

  it('evicts LRU non-active tab past the hard cap', () => {
    let tabs: FloatWidget[] = [];
    let active: string | null = null;
    let recent: string[] = [];
    for (let i = 0; i < FLOAT_TAB_HARD_CAP; i += 1) {
      const next = widget({
        type: 'document_viewer',
        messageId: `doc-${i}`,
        data: { evidence_doc_id: `id-${i}` },
      });
      const result = openFloatTabInSession(tabs, active, next, recent);
      tabs = result.tabs;
      active = result.activeTabId;
      recent = touchFloatTabRecentOrder(recent, result.activeTabId);
    }
    expect(tabs).toHaveLength(FLOAT_TAB_HARD_CAP);

    const overflow = widget({
      type: 'document_viewer',
      messageId: 'doc-overflow',
      data: { evidence_doc_id: 'overflow' },
    });
    const result = openFloatTabInSession(tabs, active, overflow, recent);
    expect(result.tabs).toHaveLength(FLOAT_TAB_HARD_CAP);
    expect(result.evicted).not.toBeNull();
    expect(result.activeTabId).toBe('document:overflow');
  });

  it('keeps the newest inactive tabs for keep-alive', () => {
    const keep = floatTabKeepAliveIds(
      ['a', 'b', 'c', 'd', 'e'],
      'e',
      3,
    );
    expect([...keep]).toEqual(['d', 'c', 'b']);
  });
});

describe('float session persistence', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('round-trips a session so a refresh can restore every open tab', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    const b = widget({
      type: 'assessment_workspace',
      messageId: 'workspace-1',
      data: { instance_id: 'inst-1' },
    });

    writePersistedFloatSession('project-1', {
      tabs: [a, b],
      activeTabId: 'assessment:inst-1',
      recentOrder: ['document:a', 'assessment:inst-1'],
    });

    const restored = readPersistedFloatSession('project-1');
    expect(restored?.tabs).toHaveLength(2);
    expect(restored?.activeTabId).toBe('assessment:inst-1');
    expect(restored?.recentOrder).toEqual(['document:a', 'assessment:inst-1']);
  });

  it('scopes sessions per project', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    writePersistedFloatSession('project-1', { tabs: [a], activeTabId: 'document:a', recentOrder: [] });

    expect(readPersistedFloatSession('project-2')).toBeNull();
    expect(readPersistedFloatSession('project-1')?.tabs).toHaveLength(1);
  });

  it('removes storage when writing an empty session', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    writePersistedFloatSession('project-1', { tabs: [a], activeTabId: 'document:a', recentOrder: [] });
    expect(readPersistedFloatSession('project-1')).not.toBeNull();

    writePersistedFloatSession('project-1', { tabs: [], activeTabId: null, recentOrder: [] });
    expect(readPersistedFloatSession('project-1')).toBeNull();
  });

  it('clears a persisted session explicitly', () => {
    const a = widget({ type: 'document_viewer', messageId: 'doc-a', data: { evidence_doc_id: 'a' } });
    writePersistedFloatSession('project-1', { tabs: [a], activeTabId: 'document:a', recentOrder: [] });
    clearPersistedFloatSession('project-1');
    expect(readPersistedFloatSession('project-1')).toBeNull();
  });

  it('ignores corrupt storage instead of throwing', () => {
    window.sessionStorage.setItem('nitrogen:float-session:project-1', '{not valid json');
    expect(readPersistedFloatSession('project-1')).toBeNull();
  });
});

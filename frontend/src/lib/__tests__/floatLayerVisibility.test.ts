import {
  floatSessionAfterHide,
  floatSessionAfterTabsCleared,
  shouldShowFloatLayer,
} from '@/lib/floatLayerVisibility';
import {
  openFloatTabInSession,
  touchFloatTabRecentOrder,
} from '@/lib/floatTabSession';
import type { FloatWidget } from '@/components/editor/FloatLayer';

function widget(partial: Partial<FloatWidget> & Pick<FloatWidget, 'type' | 'messageId'>): FloatWidget {
  return {
    data: partial.data ?? {},
    ...partial,
  };
}

describe('floatLayerVisibility', () => {
  it('hides the window while preserving that tabs still exist', () => {
    expect(shouldShowFloatLayer(2, false)).toBe(true);
    expect(shouldShowFloatLayer(2, true)).toBe(false);
    expect(floatSessionAfterHide({ tabsLength: 2, activeTabId: 'document:a' })).toEqual({
      floatLayerHidden: true,
      preserveTabs: true,
      activeTabId: 'document:a',
    });
  });

  it('resets hide when the tab session is fully cleared', () => {
    expect(floatSessionAfterTabsCleared()).toEqual({
      floatLayerHidden: false,
      tabsLength: 0,
      activeTabId: null,
    });
    expect(shouldShowFloatLayer(0, true)).toBe(false);
  });
});

describe('float tab activation races', () => {
  it('settles on the last opened tab when A then B open rapidly', () => {
    const assessment = widget({
      type: 'assessment_workspace',
      messageId: 'ws-1',
      data: { instance_id: 'inst-a' },
    });
    const other = widget({
      type: 'assessment_workspace',
      messageId: 'ws-2',
      data: { instance_id: 'inst-b' },
    });

    const first = openFloatTabInSession([], null, assessment, []);
    const recent = touchFloatTabRecentOrder([], first.activeTabId);
    const second = openFloatTabInSession(first.tabs, first.activeTabId, other, recent);

    expect(second.tabs).toHaveLength(2);
    expect(second.activeTabId).toBe('assessment:inst-b');
  });

  it('activates a file tab even when an assessment is already active', () => {
    const assessment = widget({
      type: 'assessment_workspace',
      messageId: 'ws-1',
      data: { instance_id: 'inst-a' },
    });
    const file = widget({
      type: 'document_viewer',
      messageId: 'doc-1',
      data: { evidence_doc_id: 'ev-1', title: 'PPA.pdf' },
    });

    const openAssessment = openFloatTabInSession([], null, assessment, []);
    const openFile = openFloatTabInSession(
      openAssessment.tabs,
      openAssessment.activeTabId,
      file,
      [openAssessment.activeTabId],
    );

    expect(openFile.activeTabId).toBe('document:ev-1');
    expect(openFile.tabs.map((t) => t.type)).toEqual([
      'assessment_workspace',
      'document_viewer',
    ]);
  });
});

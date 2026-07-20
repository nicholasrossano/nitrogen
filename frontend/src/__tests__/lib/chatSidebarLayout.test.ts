import {
  CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX,
  CHAT_EDITOR_PANEL_MAX_CONTENT_RATIO,
  CHAT_EDITOR_PANEL_MIN_WIDTH_PX,
  CHAT_EDITOR_PANEL_WITH_COMPANION_MIN_WIDTH_PX,
  COMPANION_SIDE_PANEL_WIDTH_PX,
  clampChatEditorPanelWidth,
} from '@/components/ui/chatSidebarLayout';

describe('clampChatEditorPanelWidth', () => {
  it('keeps the normal docked float within 60% of the content stage', () => {
    const contentWidth = 1400;
    const maxDocked = Math.floor(contentWidth * CHAT_EDITOR_PANEL_MAX_CONTENT_RATIO);
    expect(clampChatEditorPanelWidth(CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX, { contentWidth }))
      .toBe(CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX);
    expect(clampChatEditorPanelWidth(200, { contentWidth })).toBe(CHAT_EDITOR_PANEL_MIN_WIDTH_PX);
    expect(clampChatEditorPanelWidth(2000, { contentWidth })).toBe(maxDocked);
  });

  it('raises min width when a companion side panel is open', () => {
    const withCompanion = clampChatEditorPanelWidth(
      CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX + COMPANION_SIDE_PANEL_WIDTH_PX,
      { contentWidth: 1600, companionOpen: true },
    );
    expect(withCompanion).toBeGreaterThanOrEqual(CHAT_EDITOR_PANEL_WITH_COMPANION_MIN_WIDTH_PX);
    expect(withCompanion).toBe(
      CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX + COMPANION_SIDE_PANEL_WIDTH_PX,
    );
  });
});

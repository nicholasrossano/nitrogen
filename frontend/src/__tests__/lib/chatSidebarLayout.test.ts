import {
  CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX,
  CHAT_EDITOR_PANEL_MAX_WIDTH_PX,
  CHAT_EDITOR_PANEL_MIN_WIDTH_PX,
  CHAT_EDITOR_PANEL_WITH_COMPANION_MIN_WIDTH_PX,
  COMPANION_SIDE_PANEL_WIDTH_PX,
  clampChatEditorPanelWidth,
} from '@/components/ui/chatSidebarLayout';

describe('clampChatEditorPanelWidth', () => {
  it('keeps the normal docked float within the content-only band', () => {
    expect(clampChatEditorPanelWidth(CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX, { viewportWidth: 1400 }))
      .toBe(CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX);
    expect(clampChatEditorPanelWidth(200, { viewportWidth: 1400 })).toBe(CHAT_EDITOR_PANEL_MIN_WIDTH_PX);
    expect(clampChatEditorPanelWidth(2000, { viewportWidth: 1400 })).toBe(CHAT_EDITOR_PANEL_MAX_WIDTH_PX);
  });

  it('raises min width when a companion side panel is open', () => {
    const withCompanion = clampChatEditorPanelWidth(
      CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX + COMPANION_SIDE_PANEL_WIDTH_PX,
      { viewportWidth: 1600, companionOpen: true },
    );
    expect(withCompanion).toBeGreaterThanOrEqual(CHAT_EDITOR_PANEL_WITH_COMPANION_MIN_WIDTH_PX);
    expect(withCompanion).toBe(
      CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX + COMPANION_SIDE_PANEL_WIDTH_PX,
    );
  });
});

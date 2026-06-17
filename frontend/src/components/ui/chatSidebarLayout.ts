export const CHAT_SIDEBAR_MARGIN = '0.75rem';
export const CHAT_SIDEBAR_EXPANDED_WIDTH = '18rem';
export const CHAT_SIDEBAR_COLLAPSED_WIDTH = '2.75rem';
export const CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'nitrogen-chat-sidebar-collapsed';

/** Right-side floating panels (context stack, assumptions detail). */
export const CHAT_CONTEXT_STACK_WIDTH = 'min(22rem, 34vw)';
export const CHAT_CONTEXT_STACK_GUTTER = `calc(${CHAT_SIDEBAR_MARGIN} + ${CHAT_CONTEXT_STACK_WIDTH} + ${CHAT_SIDEBAR_MARGIN})`;

/** Resizable chat editor / assessment panel. */
export const CHAT_EDITOR_PANEL_MIN_WIDTH_PX = 480;
export const CHAT_EDITOR_PANEL_MAX_WIDTH_PX = 760;
export const CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX = 544;
export const CHAT_EDITOR_PANEL_WIDTH_STORAGE_KEY = 'nitrogen-chat-editor-panel-width';

export function clampChatEditorPanelWidth(widthPx: number, viewportWidth?: number): number {
  const vw = viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const maxByViewport = Math.floor(vw * 0.58);
  const max = Math.min(CHAT_EDITOR_PANEL_MAX_WIDTH_PX, maxByViewport);
  return Math.min(max, Math.max(CHAT_EDITOR_PANEL_MIN_WIDTH_PX, Math.round(widthPx)));
}

export function chatEditorPanelGutter(widthPx: number): string {
  return `calc(${CHAT_SIDEBAR_MARGIN} + ${widthPx}px + ${CHAT_SIDEBAR_MARGIN})`;
}

export function readChatEditorPanelWidth(): number {
  if (typeof window === 'undefined') return CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX;
  try {
    const raw = localStorage.getItem(CHAT_EDITOR_PANEL_WIDTH_STORAGE_KEY);
    if (!raw) return CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX;
    return clampChatEditorPanelWidth(parsed);
  } catch {
    return CHAT_EDITOR_PANEL_DEFAULT_WIDTH_PX;
  }
}

export function writeChatEditorPanelWidth(widthPx: number) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      CHAT_EDITOR_PANEL_WIDTH_STORAGE_KEY,
      String(clampChatEditorPanelWidth(widthPx)),
    );
  } catch {
    // ignore
  }
}

/** Shared border, shadow, and surface for floating chat-shell panels (sidebar, health, editor). */
export const CHAT_FLOATING_PANEL_CHROME =
  'rounded-2xl bg-surface border border-stroke-subtle shadow-[0_4px_24px_rgba(15,23,42,0.08)]';

export function chatShellContentGutter(collapsed: boolean): string {
  const drawerWidth = collapsed ? CHAT_SIDEBAR_COLLAPSED_WIDTH : CHAT_SIDEBAR_EXPANDED_WIDTH;
  return `calc(${CHAT_SIDEBAR_MARGIN} + ${drawerWidth} + ${CHAT_SIDEBAR_MARGIN})`;
}

export function readChatSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeChatSidebarCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore
  }
}

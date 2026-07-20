/**
 * Float layer window visibility vs tab session.
 *
 * - Hide (window X): keep tabs, set hidden=true → layer unmounts but session remains.
 * - Close tab (tab strip X): remove one tab; if none left, clear hidden.
 * - Close session: discard every tab and clear hidden.
 */
export function shouldShowFloatLayer(tabCount: number, floatLayerHidden: boolean): boolean {
  return tabCount > 0 && !floatLayerHidden;
}

/** After hiding the window, tabs and active id must still be present for restore. */
export function floatSessionAfterHide(opts: {
  tabsLength: number;
  activeTabId: string | null;
}): { floatLayerHidden: boolean; preserveTabs: boolean; activeTabId: string | null } {
  if (opts.tabsLength === 0) {
    return { floatLayerHidden: false, preserveTabs: false, activeTabId: null };
  }
  return {
    floatLayerHidden: true,
    preserveTabs: true,
    activeTabId: opts.activeTabId,
  };
}

/** Closing the last tab resets hide so a later open is not stuck invisible. */
export function floatSessionAfterTabsCleared(): {
  floatLayerHidden: boolean;
  tabsLength: number;
  activeTabId: null;
} {
  return { floatLayerHidden: false, tabsLength: 0, activeTabId: null };
}

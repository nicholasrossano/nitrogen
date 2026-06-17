'use client';

import { createContext, useContext, useEffect, useRef, type MutableRefObject } from 'react';
import type { NavItem } from './SideDrawer';

interface ShellNavContextValue {
  navHandlerRef: MutableRefObject<((item: NavItem) => boolean) | null>;
  chatSidebarCollapsed: boolean;
  toggleChatSidebar: () => void;
}

export const ShellNavContext = createContext<ShellNavContextValue>({
  navHandlerRef: { current: null },
  chatSidebarCollapsed: false,
  toggleChatSidebar: () => {},
});

/**
 * Pages call this to register a navigation handler that intercepts SideDrawer
 * nav clicks. Return `true` from the handler to signal "handled" — the
 * SideDrawer will skip its default URL-based navigation.
 */
export function useShellNav(handler: (item: NavItem) => boolean) {
  const { navHandlerRef } = useContext(ShellNavContext);
  useEffect(() => {
    navHandlerRef.current = handler;
    return () => { navHandlerRef.current = null; };
  }, [handler, navHandlerRef]);
}

export function useChatSidebar() {
  const { chatSidebarCollapsed, toggleChatSidebar } = useContext(ShellNavContext);
  return { chatSidebarCollapsed, toggleChatSidebar };
}

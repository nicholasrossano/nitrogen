'use client';

import 'katex/dist/katex.min.css';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChatShellProvider } from '@/components/chat-shell/ChatShellProvider';
import { TourProvider } from '@/components/tour/TourProvider';
import { SideDrawer } from '@/components/ui';
import { ShellNavContext } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import {
  chatShellContentGutter,
  readChatSidebarCollapsed,
  writeChatSidebarCollapsed,
} from '@/components/ui/chatSidebarLayout';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { MobileShellChrome } from '@/components/demo/MobileShellChrome';
import { useIsMobile, useViewportResolved } from '@/hooks/useIsMobile';

function ShellTourProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <TourProvider>{children}</TourProvider>
    </Suspense>
  );
}

function ChatShellFrame({ children }: { children: React.ReactNode }) {
  const navHandlerRef = useRef<((item: NavItem) => boolean) | null>(null);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const viewportReady = useViewportResolved();
  // Remember desktop collapse preference across mobile sessions without overwriting it.
  const desktopCollapsedRef = useRef<boolean | null>(null);

  // After viewport resolves: force collapsed on mobile; restore stored preference on desktop.
  useEffect(() => {
    if (!viewportReady) return;
    if (isMobile) {
      setChatSidebarCollapsed(true);
      return;
    }
    const stored = desktopCollapsedRef.current ?? readChatSidebarCollapsed();
    desktopCollapsedRef.current = stored;
    setChatSidebarCollapsed(stored);
  }, [isMobile, viewportReady]);

  useEffect(() => {
    const expandForTour = () => {
      setChatSidebarCollapsed(false);
      if (!isMobile) {
        writeChatSidebarCollapsed(false);
        desktopCollapsedRef.current = false;
      }
    };
    window.addEventListener('nitrogen:tour-expand-sidebar', expandForTour);
    return () => window.removeEventListener('nitrogen:tour-expand-sidebar', expandForTour);
  }, [isMobile]);

  const toggleChatSidebar = useCallback(() => {
    setChatSidebarCollapsed((prev) => {
      const next = !prev;
      // Persist only on desktop so mobile open/close does not clobber the desktop preference.
      if (!isMobile) {
        writeChatSidebarCollapsed(next);
        desktopCollapsedRef.current = next;
      }
      return next;
    });
  }, [isMobile]);

  return (
    <ShellNavContext.Provider
      value={{ navHandlerRef, chatSidebarCollapsed, toggleChatSidebar }}
    >
      <div className="relative h-screen w-full overflow-hidden max-md:h-[100dvh]">
        {/* Full-viewport canvas — one flat surface color behind drawer + content */}
        <div className="absolute inset-0 bg-surface" aria-hidden="true" />
        <div className="absolute inset-0 flex flex-col min-h-0 min-w-0">
          <div
            className="flex-1 flex flex-col min-h-0 min-w-0 transition-[padding-left] duration-300 ease-in-out max-md:overflow-x-hidden"
            style={{ paddingLeft: isMobile ? 0 : chatShellContentGutter(chatSidebarCollapsed) }}
          >
            {children}
          </div>
        </div>
        <Suspense>
          <SideDrawer />
        </Suspense>
        <MobileShellChrome />
        <DemoBanner />
      </div>
    </ShellNavContext.Provider>
  );
}

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const navHandlerRef = useRef<((item: NavItem) => boolean) | null>(null);
  const pathname = usePathname();
  const isChatShell = pathname.startsWith('/chat') || pathname === '/' || pathname.startsWith('/projects/');

  if (isChatShell) {
    return (
      <Suspense>
        <ChatShellProvider>
          <ShellTourProvider>
            <ChatShellFrame>{children}</ChatShellFrame>
          </ShellTourProvider>
        </ChatShellProvider>
      </Suspense>
    );
  }

  return (
    <ShellTourProvider>
      <ShellNavContext.Provider value={{ navHandlerRef, chatSidebarCollapsed: false, toggleChatSidebar: () => {} }}>
        <div className="h-screen flex bg-background overflow-hidden max-md:h-[100dvh]">
          <Suspense>
            <SideDrawer />
          </Suspense>
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {children}
          </div>
        </div>
      </ShellNavContext.Provider>
    </ShellTourProvider>
  );
}

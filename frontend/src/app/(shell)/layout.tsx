'use client';

import 'katex/dist/katex.min.css';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChatShellProvider } from '@/components/chat-shell/ChatShellProvider';
import { SideDrawer } from '@/components/ui';
import { ShellNavContext } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import {
  chatShellContentGutter,
  readChatSidebarCollapsed,
  writeChatSidebarCollapsed,
} from '@/components/ui/chatSidebarLayout';

function ChatShellFrame({ children }: { children: React.ReactNode }) {
  const navHandlerRef = useRef<((item: NavItem) => boolean) | null>(null);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);

  useEffect(() => {
    setChatSidebarCollapsed(readChatSidebarCollapsed());
  }, []);

  const toggleChatSidebar = useCallback(() => {
    setChatSidebarCollapsed((prev) => {
      const next = !prev;
      writeChatSidebarCollapsed(next);
      return next;
    });
  }, []);

  return (
    <ShellNavContext.Provider
      value={{ navHandlerRef, chatSidebarCollapsed, toggleChatSidebar }}
    >
      <div className="relative h-screen w-full overflow-hidden">
        {/* Full-viewport canvas — one flat surface color behind drawer + content */}
        <div className="absolute inset-0 bg-surface" aria-hidden="true" />
        <div className="absolute inset-0 flex flex-col min-h-0 min-w-0">
          <div
            className="flex-1 flex flex-col min-h-0 min-w-0 transition-[padding-left] duration-300 ease-in-out"
            style={{ paddingLeft: chatShellContentGutter(chatSidebarCollapsed) }}
          >
            {children}
          </div>
        </div>
        <Suspense>
          <SideDrawer />
        </Suspense>
      </div>
    </ShellNavContext.Provider>
  );
}

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const navHandlerRef = useRef<((item: NavItem) => boolean) | null>(null);
  const pathname = usePathname();
  const isChatShell = pathname.startsWith('/chat') || pathname === '/';

  if (isChatShell) {
    return (
      <Suspense>
        <ChatShellProvider>
          <ChatShellFrame>{children}</ChatShellFrame>
        </ChatShellProvider>
      </Suspense>
    );
  }

  return (
    <ShellNavContext.Provider value={{ navHandlerRef, chatSidebarCollapsed: false, toggleChatSidebar: () => {} }}>
      <div className="h-screen flex bg-background overflow-hidden">
        <Suspense>
          <SideDrawer />
        </Suspense>
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {children}
        </div>
      </div>
    </ShellNavContext.Provider>
  );
}

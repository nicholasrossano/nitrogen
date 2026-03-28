'use client';

import { Suspense, useRef } from 'react';
import { SideDrawer } from '@/components/ui';
import { ShellNavContext } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const navHandlerRef = useRef<((item: NavItem) => boolean) | null>(null);

  return (
    <ShellNavContext.Provider value={{ navHandlerRef }}>
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

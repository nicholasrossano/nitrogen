import type { ReactNode } from 'react';

interface ShellPageHeaderProps {
  children: ReactNode;
  chromeReady?: boolean;
}

export function ShellPageHeader({ children, chromeReady = true }: ShellPageHeaderProps) {
  return (
    <header
      className={`shrink-0 h-12 transition-opacity duration-300 ${
        chromeReady ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="h-full min-w-0">{children}</div>
    </header>
  );
}

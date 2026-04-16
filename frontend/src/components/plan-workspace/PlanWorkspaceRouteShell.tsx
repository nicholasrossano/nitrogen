'use client';

import { Sprout, TreeDeciduous } from 'lucide-react';
import type { ReactNode } from 'react';

interface PlanWorkspaceRouteShellProps {
  ready: boolean;
  showOverlay: boolean;
  showSprout: boolean;
  uploadError?: string | null;
  readOnly: boolean;
  hasPlan: boolean;
  mainContent: ReactNode;
  onboardingContent: ReactNode;
  emptyContent: ReactNode;
  documentViewer?: ReactNode;
}

export function PlanWorkspaceRouteShell({
  ready,
  showOverlay,
  showSprout,
  uploadError,
  readOnly,
  hasPlan,
  mainContent,
  onboardingContent,
  emptyContent,
  documentViewer,
}: PlanWorkspaceRouteShellProps) {
  return (
    <main className="h-full min-w-0 flex overflow-hidden relative">
      {showOverlay && (
        <div
          className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-surface/95 backdrop-blur-xl transition-opacity duration-300 ${ready ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div className="relative w-10 h-10">
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
              <Sprout className="w-6 h-6 text-accent" strokeWidth={1.5} />
            </div>
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${!showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
              <TreeDeciduous className="w-6 h-6 text-accent" strokeWidth={1.5} />
            </div>
          </div>
          <span className="text-xs text-text-secondary font-medium tracking-wide">Loading plan...</span>
        </div>
      )}

      {uploadError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2">
          <div className="bg-indicator-orange/10 border border-indicator-orange/30 rounded px-4 py-3 shadow-lg max-w-md">
            <p className="text-sm text-indicator-orange font-medium">{uploadError}</p>
          </div>
        </div>
      )}

      {hasPlan ? (
        <>
          <div className="flex-1 overflow-hidden min-w-0">{mainContent}</div>
          {documentViewer}
        </>
      ) : !readOnly ? (
        <div className="flex-1 overflow-hidden h-full">
          {onboardingContent}
        </div>
      ) : hasPlan ? (
        <div className="flex-1 overflow-hidden h-full">{mainContent}</div>
      ) : (
        <div className="flex-1 overflow-hidden h-full flex items-center justify-center">
          {emptyContent}
        </div>
      )}
    </main>
  );
}

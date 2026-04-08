'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { ModuleLandingPage } from '@/components/chat/ModuleLandingPage';
import { OpenModuleBrowser } from '@/components/chat/OpenModuleModal';
import type { ModuleInstance } from '@/lib/api';

export type WorkspaceLaunchMode = 'idle' | 'new' | 'open';

interface WorkspaceHubProps {
  initiativeId: string;
  launchMode?: WorkspaceLaunchMode;
  onLaunchModeHandled?: () => void;
  onSelectModule: (moduleId: string, moduleName: string) => void;
  onSelectExisting: (instance: ModuleInstance) => void;
}

export function WorkspaceHub({
  initiativeId,
  launchMode = 'idle',
  onLaunchModeHandled,
  onSelectModule,
  onSelectExisting,
}: WorkspaceHubProps) {
  const [mode, setMode] = useState<'new' | 'open'>('new');

  useEffect(() => {
    if (launchMode === 'new') {
      setMode('new');
      onLaunchModeHandled?.();
    } else if (launchMode === 'open') {
      setMode('open');
      onLaunchModeHandled?.();
    }
  }, [launchMode, onLaunchModeHandled]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8">
          <div className="mb-8 flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                if (mode === 'new') {
                  setMode('open');
                } else {
                  setMode('new');
                }
              }}
              className={`${mode === 'new' ? 'btn-secondary' : 'btn-primary'} !h-[36px] !text-xs !leading-none !px-4 !py-0`}
            >
              {mode === 'new' ? (
                <>
                  <FolderOpen className="w-3 h-3" />
                  Open Module
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  New Module
                </>
              )}
            </button>
          </div>
        {mode === 'new' ? (
          <ModuleLandingPage onSelectModule={onSelectModule} showIntro={false} />
        ) : (
          <OpenModuleBrowser
            initiativeId={initiativeId}
            onSelect={onSelectExisting}
          />
        )}
        </div>
      </div>
    </div>
  );
}

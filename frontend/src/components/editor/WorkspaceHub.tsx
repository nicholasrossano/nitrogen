'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { ModuleLandingPage } from '@/components/chat/ModuleLandingPage';
import { OpenModuleModal } from '@/components/chat/OpenModuleModal';
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
  const [showPicker, setShowPicker] = useState(true);
  const [showOpenModal, setShowOpenModal] = useState(false);

  useEffect(() => {
    if (launchMode === 'new') {
      setShowPicker(true);
      onLaunchModeHandled?.();
    } else if (launchMode === 'open') {
      setShowOpenModal(true);
      onLaunchModeHandled?.();
    }
  }, [launchMode, onLaunchModeHandled]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="flex-shrink-0 border-b border-divider px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Workspace</h2>
            <p className="mt-1 text-xs text-text-tertiary">
              Start a new module or reopen an existing workspace for this project.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="btn-primary !h-[36px] !text-xs !leading-none !px-4 !py-0"
            >
              <Plus className="w-3 h-3" />
              New Module
            </button>
            <button
              type="button"
              onClick={() => setShowOpenModal(true)}
              className="btn-secondary !h-[36px] !text-xs !leading-none !px-4 !py-0"
            >
              <FolderOpen className="w-3 h-3" />
              Open Module
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {showPicker ? (
          <ModuleLandingPage onSelectModule={onSelectModule} showIntro={false} />
        ) : (
          <div className="flex h-full items-center justify-center px-8">
            <div className="max-w-md text-center">
              <p className="text-sm text-text-secondary">
                Use the actions above to start a new module or pick up an existing one.
              </p>
            </div>
          </div>
        )}
      </div>

      {showOpenModal && (
        <OpenModuleModal
          initiativeId={initiativeId}
          onSelect={(instance) => {
            setShowOpenModal(false);
            onSelectExisting(instance);
          }}
          onClose={() => setShowOpenModal(false)}
        />
      )}
    </div>
  );
}

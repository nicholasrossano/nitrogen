'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { ModuleLandingPage } from '@/components/chat/ModuleLandingPage';
import { OpenModuleBrowser } from '@/components/chat/OpenModuleModal';
import { api, type ModuleInstance } from '@/lib/api';

export type WorkspaceLaunchMode = 'idle' | 'new' | 'open';

const hubModeStorageKey = (initiativeId: string) =>
  `nitrogen_workspace_hub_mode_${initiativeId}`;

function readStoredHubMode(initiativeId: string): 'new' | 'open' | null {
  if (typeof sessionStorage === 'undefined') return null;
  const v = sessionStorage.getItem(hubModeStorageKey(initiativeId));
  if (v === 'new' || v === 'open') return v;
  return null;
}

function writeStoredHubMode(initiativeId: string, mode: 'new' | 'open') {
  try {
    sessionStorage.setItem(hubModeStorageKey(initiativeId), mode);
  } catch {
    /* ignore quota / private mode */
  }
}

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
  const [mode, setMode] = useState<'new' | 'open'>(() => readStoredHubMode(initiativeId) ?? 'new');
  const [idleDefaultPending, setIdleDefaultPending] = useState(
    () => launchMode === 'idle' && readStoredHubMode(initiativeId) === null,
  );

  useEffect(() => {
    if (launchMode === 'new') {
      setMode('new');
      setIdleDefaultPending(false);
      writeStoredHubMode(initiativeId, 'new');
      onLaunchModeHandled?.();
    } else if (launchMode === 'open') {
      setMode('open');
      setIdleDefaultPending(false);
      writeStoredHubMode(initiativeId, 'open');
      onLaunchModeHandled?.();
    }
  }, [launchMode, initiativeId, onLaunchModeHandled]);

  useEffect(() => {
    if (launchMode !== 'idle') return;
    if (readStoredHubMode(initiativeId) !== null) {
      setIdleDefaultPending(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listModuleInstances(initiativeId);
        if (cancelled) return;
        // Explicit New/Open from parent may have written storage while we were in flight.
        if (readStoredHubMode(initiativeId) !== null) {
          setIdleDefaultPending(false);
          return;
        }
        const next = list.length > 0 ? 'open' : 'new';
        setMode(next);
        writeStoredHubMode(initiativeId, next);
      } catch {
        if (!cancelled && readStoredHubMode(initiativeId) === null) {
          setMode('new');
          writeStoredHubMode(initiativeId, 'new');
        }
      } finally {
        if (!cancelled) setIdleDefaultPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initiativeId, launchMode]);

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
                  writeStoredHubMode(initiativeId, 'open');
                } else {
                  setMode('new');
                  writeStoredHubMode(initiativeId, 'new');
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
        {idleDefaultPending ? (
          <p className="text-center text-sm text-text-tertiary py-12">Loading…</p>
        ) : mode === 'new' ? (
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

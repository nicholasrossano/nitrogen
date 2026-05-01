'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/ModulePicker';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

export type AssociatedChatModule = {
  instance_id: string;
  module_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
};

interface AssociatedModulesTrayProps {
  modules: AssociatedChatModule[];
  onOpenWorkspaceModule?: (module: {
    instanceId: string;
    moduleId: string;
    title?: string | null;
    chatId?: string | null;
    chatTitle?: string | null;
  }) => void;
}

export function AssociatedModulesTray({
  modules,
  onOpenWorkspaceModule,
}: AssociatedModulesTrayProps) {
  const showBetaModules = useFeatureFlag('beta_modules');
  const [collapsed, setCollapsed] = useState(false);
  const visibleModules = modules.filter((module) => {
    const moduleOption = ALL_MODULES.find((candidate) => candidate.id === module.module_id);
    if (!moduleOption) return false;
    return showBetaModules || !moduleOption.beta;
  });

  return (
    <div className="overflow-hidden rounded-t-xl rounded-b-none border border-stroke-subtle bg-white shadow-[0_-1px_0_rgba(0,0,0,0.02)]">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-surface-subtle/70"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand associated modules' : 'Collapse associated modules'}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <span>{visibleModules.length} Module{visibleModules.length === 1 ? '' : 's'}</span>
      </button>
      {!collapsed ? (
        <div className="border-t border-stroke-subtle bg-white">
          {visibleModules.map((module, index) => {
            const moduleOption = ALL_MODULES.find((candidate) => candidate.id === module.module_id);
            if (!moduleOption) return null;

            const title = module.title?.trim() || moduleOption.name;

            return (
              <button
                key={module.instance_id}
                type="button"
                onClick={() =>
                  onOpenWorkspaceModule?.({
                    instanceId: module.instance_id,
                    moduleId: module.module_id,
                    title,
                  })
                }
                disabled={!onOpenWorkspaceModule}
                className={[
                  'group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70',
                  index > 0 ? 'border-t border-stroke-subtle' : '',
                  'text-text-secondary enabled:hover:bg-surface-subtle enabled:hover:text-text-primary',
                ].join(' ')}
                aria-label={title}
              >
                <span className="text-accent">
                  {moduleOption.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {title}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-quaternary transition-colors group-enabled:group-hover:text-text-tertiary" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { useSettingsStore } from '@/stores/settingsStore';

interface ModuleLandingPageProps {
  onSelectModule: (moduleId: string, moduleName: string) => void;
}

export function ModuleLandingPage({ onSelectModule }: ModuleLandingPageProps) {
  const devMode = useSettingsStore((s) => s.devMode);

  const moduleMap = new Map(ALL_MODULES.map((m) => [m.id, m]));

  const visibleCategories = MODULE_CATEGORIES.map((category) => {
    const modules = category.moduleIds
      .map((id) => moduleMap.get(id))
      .filter((m): m is NonNullable<typeof m> => {
        if (!m) return false;
        // In non-dev mode, hide beta modules
        if (!devMode && m.beta) return false;
        return true;
      });
    return { ...category, resolvedModules: modules };
  }).filter((cat) => devMode || cat.resolvedModules.length > 0);

  return (
    <div className="flex flex-col items-center h-full px-4 py-10 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <h1 className="text-lg font-semibold text-text-primary mb-1">New Module</h1>
        <p className="text-sm text-text-tertiary mb-8">
          Select a module to create a structured output.
        </p>

        <div className="flex flex-col gap-8">
          {visibleCategories.map((category) => {
            const isEmpty = category.resolvedModules.length === 0;
            return (
              <div key={category.id}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3 px-0.5">
                  {category.name}
                  {devMode && isEmpty && (
                    <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-text-tertiary/60">
                      (empty)
                    </span>
                  )}
                </p>
                {isEmpty ? (
                  devMode && (
                    <div className="rounded-lg border border-dashed border-stroke-subtle px-4 py-3">
                      <p className="text-xs text-text-tertiary/60 italic">No modules in this category yet.</p>
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {category.resolvedModules.map((module) => {
                      const isTemplate = module.id === 'template_fill';
                      return (
                        <button
                          key={module.id}
                          type="button"
                          onClick={() => onSelectModule(module.id, module.name)}
                          className={`relative flex flex-col items-center justify-center gap-1.5 px-2 h-[72px] rounded-lg transition-colors duration-150 cursor-pointer ${
                            isTemplate
                              ? 'border-2 border-dashed border-accent-secondary/30 bg-accent-secondary/[0.05] hover:border-accent-secondary/50 hover:bg-accent-secondary/[0.09]'
                              : 'border border-accent/15 bg-accent/[0.04] hover:border-accent/40 hover:bg-accent/[0.08]'
                          }`}
                        >
                          {isTemplate && (
                            <span className="absolute top-1.5 right-1.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-indicator-yellow/10 text-indicator-yellow leading-none">
                              BETA
                            </span>
                          )}
                          <span
                            className={`[&>svg]:w-4.5 [&>svg]:h-4.5 ${
                              isTemplate ? 'text-accent-secondary/70' : 'text-accent/70'
                            }`}
                          >
                            {module.icon}
                          </span>
                          <span className="text-[11px] font-medium text-text-secondary leading-snug text-center">
                            {module.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

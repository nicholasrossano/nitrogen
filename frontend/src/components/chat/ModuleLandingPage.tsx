'use client';

import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { useSettingsStore } from '@/stores/settingsStore';

interface ModuleLandingPageProps {
  onSelectModule: (moduleId: string, moduleName: string) => void;
  showIntro?: boolean;
}

export function ModuleLandingPage({ onSelectModule, showIntro = true }: ModuleLandingPageProps) {
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
    <div className="flex flex-col items-center h-full px-6 md:px-8 py-8 overflow-y-auto">
      <div className="w-full max-w-3xl">
        {showIntro ? (
          <>
            <h1 className="text-lg font-semibold text-text-primary mb-1">New Module</h1>
            <p className="text-sm text-text-tertiary mb-8">
              Choose a module to generate a structured output tailored to your project context, from feasibility models
              and impact estimates to planning and delivery documents.
            </p>
          </>
        ) : (
          <p className="text-sm text-text-tertiary mb-8">
            Choose a module to generate a structured output tailored to your project context, from feasibility models
            and impact estimates to planning and delivery documents.
          </p>
        )}

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
                  <div className="grid grid-cols-3 gap-3">
                    {category.resolvedModules.map((module) => {
                      return (
                        <button
                          key={module.id}
                          type="button"
                          onClick={() => onSelectModule(module.id, module.name)}
                          className="relative flex items-center gap-3 px-4 py-3.5 card-interactive border border-black/[0.04]"
                        >
                          <div className="w-10 h-10 flex-shrink-0 rounded flex items-center justify-center bg-accent-wash">
                            <span className="[&>svg]:w-5 [&>svg]:h-5 text-accent">
                              {module.icon}
                            </span>
                          </div>
                          <span className="text-xs font-medium text-text-secondary leading-snug text-left">
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

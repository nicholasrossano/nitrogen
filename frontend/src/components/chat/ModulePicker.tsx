'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Calculator, Leaf, X, Check, Sun, Users, Map, ShieldCheck, BarChart2 } from 'lucide-react';

export interface ModuleOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** If true, only shown when Developer > Beta features is enabled in Settings. */
  beta?: boolean;
}

export const ALL_MODULES: ModuleOption[] = [
  {
    id: 'lcoe_model',
    name: 'LCOE Model',
    description: 'Calculate levelized cost of energy',
    icon: <Calculator className="w-3.5 h-3.5" />,
  },
  {
    id: 'carbon_model',
    name: 'Carbon Calculator',
    description: 'Estimate emission reductions (tCO₂e)',
    icon: <Leaf className="w-3.5 h-3.5" />,
  },
  {
    id: 'solar_estimate',
    name: 'Solar Production Estimate',
    description: 'Estimate annual & monthly kWh',
    icon: <Sun className="w-3.5 h-3.5" />,
  },
  {
    id: 'stakeholder_assessment',
    name: 'Stakeholder Assessment',
    description: 'Map and profile key stakeholders for your project',
    icon: <Users className="w-3.5 h-3.5" />,
  },
  {
    id: 'landscape_mapping',
    name: 'Landscape Mapping',
    description: 'Map the ecosystem of actors and initiatives',
    icon: <Map className="w-3.5 h-3.5" />,
  },
  {
    id: 'esmp',
    name: 'Environmental & Social Management Plan',
    description: 'Draft an IFC-aligned ESMP for DFI submission',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    beta: true,
  },
  {
    id: 'mel_plan',
    name: 'Monitoring, Evaluation & Learning Plan',
    description: 'Build a results framework and data collection plan',
    icon: <BarChart2 className="w-3.5 h-3.5" />,
    beta: true,
  },
];

const ANALYSIS_MODULES = ALL_MODULES.filter(
  (m) => m.id === 'lcoe_model' || m.id === 'carbon_model' || m.id === 'solar_estimate'
);

/** Modules available in the New Module landing page (standalone, not project-side-chat only) */
export const STANDALONE_MODULE_IDS = new Set(['lcoe_model', 'carbon_model', 'solar_estimate']);

export interface ModuleCategory {
  id: string;
  name: string;
  moduleIds: string[];
}

export const MODULE_CATEGORIES: ModuleCategory[] = [
  { id: 'opportunity', name: 'Opportunity Discovery', moduleIds: ['landscape_mapping'] },
  { id: 'definition', name: 'Project Definition', moduleIds: ['stakeholder_assessment'] },
  { id: 'feasibility', name: 'Feasibility & Option Analysis', moduleIds: ['lcoe_model', 'solar_estimate'] },
  { id: 'impact', name: 'Impact Assessment', moduleIds: ['carbon_model'] },
  { id: 'compliance', name: 'Compliance & Delivery Readiness', moduleIds: ['esmp', 'mel_plan'] },
];

interface ModulePickerProps {
  selected: ModuleOption | null;
  onSelect: (module: ModuleOption | null) => void;
  disabled?: boolean;
  /** 'project' shows all modules; 'standalone' shows only analysis modules */
  mode?: 'project' | 'standalone';
}

export function ModulePicker({
  selected,
  onSelect,
  disabled = false,
  mode = 'project',
}: ModulePickerProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const modules = mode === 'standalone' ? ANALYSIS_MODULES : ALL_MODULES;

  // Position the portal dropdown above the trigger button
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      // Place bottom of dropdown 8px above the top of the trigger
      top: rect.top - 8,
      transform: 'translateY(-100%)',
      width: 224,
      zIndex: 9999,
    });
  };

  const handleOpen = () => {
    updatePosition();
    setOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const handleSelect = (module: ModuleOption) => {
    onSelect(selected?.id === module.id ? null : module);
    setOpen(false);
  };

  const dropdown = open && (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="rounded-xl border border-stroke-subtle bg-white shadow-[0_8px_24px_-4px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.08)] overflow-hidden"
    >
      <div className="px-3 pt-2.5 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          Available Modules
        </p>
      </div>
      <div className="pb-1.5">
        {modules.map((module) => {
          const isActive = selected?.id === module.id;
          return (
            <button
              key={module.id}
              type="button"
              onClick={() => handleSelect(module)}
              className={[
                'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors duration-100',
                isActive ? 'bg-accent/[0.06]' : 'hover:bg-surface-subtle',
              ].join(' ')}
            >
              <span
                className={[
                  'mt-0.5 shrink-0 transition-colors',
                  isActive ? 'text-accent' : 'text-text-tertiary',
                ].join(' ')}
              >
                {module.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className={[
                    'block text-xs font-medium leading-snug',
                    isActive ? 'text-accent' : 'text-text-primary',
                  ].join(' ')}
                >
                  {module.name}
                </span>
                <span className="block text-[11px] text-text-tertiary leading-snug mt-0.5">
                  {module.description}
                </span>
              </span>
              {isActive && <Check className="w-3 h-3 text-accent shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className="w-5 h-5 flex items-center justify-center rounded-full border border-stroke-subtle transition-colors duration-150 text-text-tertiary enabled:hover:text-text-secondary enabled:hover:border-stroke-muted disabled:opacity-40 disabled:cursor-default"
        aria-label={selected ? `Module: ${selected.name}` : 'Select a module'}
      >
        <Plus className="w-[11px] h-[11px]" />
      </button>
      {typeof document !== 'undefined' && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </>
  );
}

/** Dismissable chip displayed above the textarea when a module is selected */
export function ModuleChip({
  module,
  onRemove,
}: {
  module: ModuleOption;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
      {module.icon}
      {module.name}
      <button
        type="button"
        onClick={onRemove}
        className="hover:opacity-60 transition-opacity"
        aria-label={`Remove ${module.name}`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

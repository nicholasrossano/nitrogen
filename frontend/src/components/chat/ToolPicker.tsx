'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Calculator, Leaf, FileText, CheckSquare, X, Check, Award, FileUp, Sun } from 'lucide-react';

export interface ToolOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** If true, only shown when Developer > Beta features is enabled in Settings. */
  beta?: boolean;
}

export const ALL_TOOLS: ToolOption[] = [
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
    id: 'gs_certification',
    name: 'Gold Standard Certification',
    description: 'Gold Standard checklist',
    icon: <Award className="w-3.5 h-3.5" />,
    beta: true,
  },
  {
    id: 'investment_memo',
    name: 'Investment Memo',
    description: 'Generate investment recommendation',
    icon: <FileText className="w-3.5 h-3.5" />,
  },
  {
    id: 'due_diligence_checklist',
    name: 'Due Diligence',
    description: 'Structured assessment checklist',
    icon: <CheckSquare className="w-3.5 h-3.5" />,
  },
  {
    id: 'pdd',
    name: 'Project Design Document',
    description: 'Build a PDD from project materials',
    icon: <FileText className="w-3.5 h-3.5" />,
    beta: true,
  },
  {
    id: 'template_fill',
    name: 'From Template',
    description: 'Complete a doc from project materials',
    icon: <FileUp className="w-3.5 h-3.5" />,
    beta: true,
  },
];

const ANALYSIS_TOOLS = ALL_TOOLS.filter(
  (t) => t.id === 'lcoe_model' || t.id === 'carbon_model' || t.id === 'solar_estimate' || t.id === 'gs_certification'
);

interface ToolPickerProps {
  selected: ToolOption | null;
  onSelect: (tool: ToolOption | null) => void;
  disabled?: boolean;
  /** 'project' shows all 4 tools; 'standalone' shows only analysis tools */
  mode?: 'project' | 'standalone';
}

export function ToolPicker({
  selected,
  onSelect,
  disabled = false,
  mode = 'project',
}: ToolPickerProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const tools = mode === 'standalone' ? ANALYSIS_TOOLS : ALL_TOOLS;

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

  const handleSelect = (tool: ToolOption) => {
    onSelect(selected?.id === tool.id ? null : tool);
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
          Available Tools
        </p>
      </div>
      <div className="pb-1.5">
        {tools.map((tool) => {
          const isActive = selected?.id === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => handleSelect(tool)}
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
                {tool.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className={[
                    'block text-xs font-medium leading-snug',
                    isActive ? 'text-accent' : 'text-text-primary',
                  ].join(' ')}
                >
                  {tool.name}
                </span>
                <span className="block text-[11px] text-text-tertiary leading-snug mt-0.5">
                  {tool.description}
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
        aria-label={selected ? `Tool selected: ${selected.name}` : 'Select a tool'}
      >
        <Plus className="w-[11px] h-[11px]" />
      </button>
      {typeof document !== 'undefined' && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </>
  );
}

/** Dismissable chip displayed above the textarea when a tool is selected */
export function ToolChip({
  tool,
  onRemove,
}: {
  tool: ToolOption;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
      {tool.icon}
      {tool.name}
      <button
        type="button"
        onClick={onRemove}
        className="hover:opacity-60 transition-opacity"
        aria-label={`Remove ${tool.name}`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

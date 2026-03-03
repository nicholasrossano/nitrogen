'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Calculator, Leaf, FileText, CheckSquare, X, Check } from 'lucide-react';

export interface ToolOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const ALL_TOOLS: ToolOption[] = [
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
];

const ANALYSIS_TOOLS = ALL_TOOLS.filter((t) => t.id === 'lcoe_model' || t.id === 'carbon_model');

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
  const containerRef = useRef<HTMLDivElement>(null);

  const tools = mode === 'standalone' ? ANALYSIS_TOOLS : ALL_TOOLS;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (tool: ToolOption) => {
    onSelect(selected?.id === tool.id ? null : tool);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={[
          'w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150',
          disabled
            ? 'opacity-40 cursor-default text-text-tertiary'
            : selected
            ? 'bg-accent text-white hover:bg-accent-anchor'
            : 'text-text-tertiary hover:text-text-secondary border border-stroke-subtle hover:border-stroke-muted',
        ].join(' ')}
        aria-label={selected ? `Tool selected: ${selected.name}` : 'Select a tool'}
      >
        {selected ? selected.icon : <Plus className="w-[11px] h-[11px]" />}
      </button>

      {/* Dropdown (opens upward) */}
      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-stroke-subtle bg-white shadow-[0_8px_24px_-4px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.08)] overflow-hidden z-50"
        >
          <div className="px-3 pt-2.5 pb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Run a tool
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
                    isActive
                      ? 'bg-accent/[0.06]'
                      : 'hover:bg-surface-subtle',
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
                  {isActive && (
                    <Check className="w-3 h-3 text-accent shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import type { ModuleInstance } from '@/lib/api';

interface ModuleInstanceOpenDropdownProps {
  instances: ModuleInstance[];
  onOpenInstance: (instance: ModuleInstance) => Promise<void> | void;
  getInstanceLabel: (instance: ModuleInstance) => string;
  buttonLabel?: string;
  menuClassName?: string;
  className?: string;
}

export function ModuleInstanceOpenDropdown({
  instances,
  onOpenInstance,
  getInstanceLabel,
  buttonLabel = 'Open',
  menuClassName = 'min-w-[220px]',
  className = '',
}: ModuleInstanceOpenDropdownProps) {
  const [open, setOpen] = useState(false);
  const [openingInstanceId, setOpeningInstanceId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const sortedInstances = useMemo(
    () => [...instances].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()),
    [instances],
  );

  return (
    <div ref={pickerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg whitespace-nowrap border border-stroke-subtle bg-white text-text-secondary transition-colors enabled:hover:border-stroke-muted enabled:hover:text-text-primary"
      >
        {buttonLabel}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open ? (
        <div className={`absolute right-0 top-full mt-1 z-50 max-h-64 overflow-y-auto rounded-lg border border-divider bg-white py-1 shadow-lg ${menuClassName}`}>
          {sortedInstances.map((moduleInstance) => {
            const openingThisInstance = openingInstanceId === moduleInstance.id;
            const isApprovedInstance = moduleInstance.is_plan_complete === true;
            const optionLabel = getInstanceLabel(moduleInstance);
            return (
              <button
                key={moduleInstance.id}
                type="button"
                disabled={openingThisInstance || Boolean(openingInstanceId)}
                onClick={async (event) => {
                  event.stopPropagation();
                  setOpeningInstanceId(moduleInstance.id);
                  try {
                    await onOpenInstance(moduleInstance);
                    setOpen(false);
                  } finally {
                    setOpeningInstanceId(null);
                  }
                }}
                className="w-full px-3 py-2 text-left text-xs text-text-secondary transition-colors enabled:hover:bg-surface-subtle enabled:hover:text-text-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {openingThisInstance ? 'Opening…' : optionLabel}
                  </span>
                  {isApprovedInstance ? (
                    <Check className="w-3.5 h-3.5 flex-shrink-0 text-accent" strokeWidth={2.4} />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

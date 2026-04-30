'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CustomDropdownOption {
  value: string;
  label: string;
}

interface CustomDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomDropdownOption[];
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  menuClassName?: string;
  itemClassName?: string;
}

export function CustomDropdown({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = 'Select',
  ariaLabel = 'Select option',
  className = 'h-9 min-w-[160px] inline-flex items-center justify-between gap-2 rounded-lg border border-stroke-subtle bg-white px-3 text-sm text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60',
  menuClassName = 'absolute left-0 top-full z-50 mt-1 min-w-full rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg',
  itemClassName = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="truncate">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      </button>

      {open && (
        <div className={menuClassName}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`${itemClassName} ${
                  selected
                    ? 'bg-surface-subtle text-text-primary'
                    : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                }`}
              >
                <span className="w-3.5 shrink-0">
                  {selected ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface RoleDropdownOption {
  value: string;
  label: string;
}

interface RoleDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: RoleDropdownOption[];
  disabled?: boolean;
  buttonClassName?: string;
  menuClassName?: string;
  itemClassName?: string;
}

export function RoleDropdown({
  value,
  onChange,
  options,
  disabled = false,
  buttonClassName = 'h-8 inline-flex items-center gap-1.5 px-2 rounded-lg border border-stroke-subtle bg-white text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60',
  menuClassName = 'absolute left-0 top-full z-50 mt-1 min-w-[112px] rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg',
  itemClassName = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
}: RoleDropdownProps) {
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

  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        className={buttonClassName}
        aria-label="Select role"
        aria-expanded={open}
      >
        <span>{selectedOption?.label ?? 'Select'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
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
                  {selected ? <Check className="w-3.5 h-3.5" /> : null}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

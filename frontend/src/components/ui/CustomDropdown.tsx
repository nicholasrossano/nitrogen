'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

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
  /** Open the menu above the trigger (recommended for bottom-anchored composers). */
  menuPlacement?: 'above' | 'below';
}

export function CustomDropdown({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = 'Select',
  ariaLabel = 'Select option',
  className = 'h-9 min-w-[160px] inline-flex items-center justify-between gap-2 rounded-lg border border-stroke-subtle bg-white px-3 text-sm text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60',
  menuClassName = 'min-w-full rounded-lg border border-stroke-subtle bg-white p-1 shadow-lg',
  itemClassName = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
  menuPlacement = 'below',
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const base: CSSProperties = {
      position: 'fixed',
      left: rect.left,
      minWidth: rect.width,
      maxWidth: '16rem',
      zIndex: 9999,
    };

    if (menuPlacement === 'above') {
      setMenuStyle({
        ...base,
        bottom: window.innerHeight - rect.top + gap,
      });
    } else {
      setMenuStyle({
        ...base,
        top: rect.bottom + gap,
      });
    }
  }, [menuPlacement]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
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
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div ref={menuRef} className={menuClassName} style={menuStyle} role="listbox">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
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
        </div>,
        document.body,
      )}
    </div>
  );
}

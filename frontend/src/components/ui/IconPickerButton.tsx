'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getIconByName, ICON_NAMES } from '@/lib/icons';

interface IconPickerButtonProps {
  iconName: string | null | undefined;
  onPick: (iconName: string) => void | Promise<void>;
  title?: string;
  disabled?: boolean;
  buttonClassName?: string;
  iconClassName?: string;
  pickerWidthClassName?: string;
}

export function IconPickerButton({
  iconName,
  onPick,
  title = 'Change icon',
  disabled = false,
  buttonClassName = 'w-10 h-10 rounded flex items-center justify-center bg-accent-wash hover:bg-accent/15 transition-colors',
  iconClassName = 'w-5 h-5 text-accent',
  pickerWidthClassName = 'w-[224px]',
}: IconPickerButtonProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const IconComponent = getIconByName(iconName);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPickerPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX });
    }
    setPickerOpen(true);
  }, [disabled, pickerOpen]);

  const handlePick = useCallback(async (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPickerOpen(false);
    await onPick(name);
  }, [onPick]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [pickerOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`${buttonClassName} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
        title={disabled ? undefined : title}
      >
        <IconComponent className={iconClassName} />
      </button>
      {pickerOpen && pickerPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={pickerRef}
          style={{ position: 'absolute', top: pickerPos.top, left: pickerPos.left }}
          className={`z-[9999] bg-surface border border-stroke-subtle rounded-lg shadow-lg p-2 ${pickerWidthClassName}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="grid grid-cols-7 gap-0.5 max-h-48 overflow-y-auto overflow-x-hidden">
            {ICON_NAMES.map((name) => {
              const Icon = getIconByName(name);
              const isActive = name === iconName;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={(e) => void handlePick(e, name)}
                  className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-accent/10 hover:text-accent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

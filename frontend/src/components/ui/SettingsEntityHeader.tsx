'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, X } from 'lucide-react';
import { IconPickerButton } from '@/components/ui/IconPickerButton';
import { AccentIconBadge } from '@/components/ui/AccentIconBadge';

export type SettingsEntitySwitchOption = {
  id: string;
  label: string;
  iconName?: string | null;
};

interface SettingsEntityHeaderProps {
  iconName: string;
  onIconPick?: (iconName: string) => void | Promise<void>;
  iconPickerDisabled?: boolean;
  iconSaving?: boolean;
  name: string;
  nameEditable?: boolean;
  onSaveName?: (name: string) => void | Promise<void>;
  nameSaving?: boolean;
  nameFallback?: string;
  subtitle: string;
  switchOptions?: SettingsEntitySwitchOption[];
  selectedSwitchId?: string | null;
  onSwitch?: (id: string) => void;
  switchDisabled?: boolean;
  switchAriaLabel?: string;
}

export function SettingsEntityHeader({
  iconName,
  onIconPick,
  iconPickerDisabled = false,
  iconSaving = false,
  name,
  nameEditable = false,
  onSaveName,
  nameSaving = false,
  nameFallback = 'Untitled',
  subtitle,
  switchOptions = [],
  selectedSwitchId = null,
  onSwitch,
  switchDisabled = false,
  switchAriaLabel = 'Switch',
}: SettingsEntityHeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftName(name);
    setIsEditingName(false);
  }, [name]);

  useEffect(() => {
    if (!isEditingName || !nameInputRef.current) return;
    nameInputRef.current.focus();
    nameInputRef.current.select();
  }, [isEditingName]);

  useEffect(() => {
    if (!switcherOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [switcherOpen]);

  const handleSaveName = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setDraftName(name || nameFallback);
      setIsEditingName(false);
      return;
    }
    await onSaveName?.(trimmed);
    setIsEditingName(false);
  };

  const handleCancelName = () => {
    setDraftName(name || nameFallback);
    setIsEditingName(false);
  };

  const showSwitcher = switchOptions.length > 1;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="relative flex-shrink-0">
        <IconPickerButton
          iconName={iconName}
          onPick={onIconPick ?? (() => {})}
          disabled={iconPickerDisabled || !onIconPick || iconSaving}
        />
      </div>
      <div className="min-w-0 flex-1">
        {isEditingName && nameEditable ? (
          <div className="flex items-center gap-1">
            <input
              ref={nameInputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSaveName();
                } else if (e.key === 'Escape') {
                  handleCancelName();
                }
              }}
              style={{ width: `${Math.max(draftName.length + 2, 10)}ch` }}
              className="min-w-0 px-0 py-0.5 text-sm font-medium text-text-primary bg-transparent border-0 border-b border-accent rounded-none focus:outline-none focus:ring-0"
              disabled={nameSaving}
            />
            <button
              onClick={() => void handleSaveName()}
              disabled={nameSaving}
              className="icon-btn icon-btn-success p-1 text-indicator-green flex-shrink-0"
            >
              {nameSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleCancelName}
              disabled={nameSaving}
              className="icon-btn p-1 text-text-tertiary flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 group">
            <p className="text-sm font-medium text-text-primary">
              {name || nameFallback}
            </p>
            {nameEditable && (
              <button
                onClick={() => setIsEditingName(true)}
                className="icon-btn p-1 opacity-0 group-hover:opacity-100 text-text-tertiary"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>
      </div>
      {showSwitcher && (
        <div ref={switcherRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              if (switchDisabled || switchOptions.length < 2) return;
              setSwitcherOpen((open) => !open);
            }}
            disabled={switchDisabled || switchOptions.length < 2}
            className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 flex items-center shrink-0"
            aria-label={switchAriaLabel}
            aria-expanded={switcherOpen}
          >
            Switch
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
          {switcherOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-divider bg-white py-1 shadow-lg">
              {switchOptions.map((option) => {
                const selected = option.id === selectedSwitchId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      onSwitch?.(option.id);
                    }}
                    className={`flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                      selected
                        ? 'bg-surface-subtle text-text-primary'
                        : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary'
                    }`}
                  >
                    <span className="w-3.5 shrink-0">
                      {selected ? <Check className="w-3.5 h-3.5" /> : null}
                    </span>
                    {option.iconName ? (
                      <AccentIconBadge iconName={option.iconName} size="sm" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

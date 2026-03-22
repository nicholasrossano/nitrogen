'use client';

import { useEffect, useState } from 'react';
import { X, FlaskConical } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useSettingsStore } from '@/stores/settingsStore';

interface SettingsModalProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------
// Sectioned layout — add new sections by appending <SettingsSection> blocks.
// Each toggle/input should read from and write to useSettingsStore.
// ---------------------------------------------------------------------------

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
        {title}
      </p>
      <div className="rounded-xl border border-stroke-subtle divide-y divide-stroke-subtle overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 hover:bg-surface-subtle/60 cursor-pointer select-none">
      {Icon && (
        <div className="w-7 h-7 rounded-lg bg-surface-subtle flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-text-secondary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && (
          <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
          checked ? 'bg-accent' : 'bg-surface-subtle border border-stroke-subtle'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [visible, setVisible] = useState(false);
  const { devMode, setDevMode } = useSettingsStore();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 150);
  };

  const modal = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-white shadow-2xl border border-stroke-subtle flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle flex-shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — add new <SettingsSection> blocks here */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1 min-h-0">
          <SettingsSection title="Developer">
            <SettingsRow
              icon={FlaskConical}
              label="Beta features"
              description="Unhides experimental features currently under development."
              checked={devMode}
              onChange={setDevMode}
            />
          </SettingsSection>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

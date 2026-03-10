'use client';

import { useState, useRef, useEffect } from 'react';
import { Pencil, Check, X, PanelLeft, PanelRight, SquarePen, ArrowLeft } from 'lucide-react';
import { api, Initiative } from '@/lib/api';

interface PanelToggle {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}

interface ProjectHeaderProps {
  initiative: Initiative;
  onTitleUpdate?: (title: string) => void;
  /** PanelLeft button — shown on the right side when provided */
  leftToggle?: PanelToggle;
  /** PanelRight button — shown on the right side when provided */
  rightToggle?: PanelToggle;
  /** SquarePen "new chat" button */
  onNewChat?: () => void;
  /** ArrowLeft back button — shown on the left side when provided */
  onBack?: () => void;
}

export function ProjectHeader({
  initiative,
  onTitleUpdate,
  leftToggle,
  rightToggle,
  onNewChat,
  onBack,
}: ProjectHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initiative.title || 'New Project');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(initiative.title || 'New Project');
  }, [initiative.id, initiative.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (!title.trim()) {
      setTitle(initiative.title || 'New Project');
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.updateInitiative(initiative.id, { title: title.trim() });
      onTitleUpdate?.(title.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update title:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTitle(initiative.title || 'New Project');
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    else if (e.key === 'Escape') handleCancel();
  };

  const hasRightControls = onNewChat || leftToggle || rightToggle;

  return (
    <header className="flex-shrink-0">
      <div className="px-4 h-14 flex items-center relative">
        {/* Left: back arrow */}
        {onBack && (
          <button
            onClick={onBack}
            title="Back"
            className="icon-btn p-1.5 text-text-tertiary"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Editable title — centered */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            {isEditing ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{ width: `${Math.max(title.length + 2, 12)}ch` }}
                  className="min-w-0 px-0 py-0.5 text-[13px] font-normal text-text-primary bg-transparent border-0 border-b border-accent rounded-none focus:outline-none focus:ring-0 text-center"
                  disabled={saving}
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="icon-btn icon-btn-success p-1 text-indicator-green flex-shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="icon-btn p-1 text-text-tertiary flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group">
                <h1 className="text-[13px] font-medium text-text-primary truncate">
                  {title}
                </h1>
                <button
                  onClick={() => setIsEditing(true)}
                  className="icon-btn p-1 opacity-0 group-hover:opacity-100 text-text-tertiary"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right controls: panel toggles + new chat */}
        {hasRightControls && (
          <div className="ml-auto flex items-center gap-1">
            {leftToggle && (
              <button
                onClick={leftToggle.disabled ? undefined : leftToggle.onClick}
                disabled={leftToggle.disabled}
                title={leftToggle.title}
                className={`icon-btn p-1.5 ${leftToggle.active ? 'text-accent' : 'text-text-tertiary'} ${leftToggle.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            {rightToggle && (
              <button
                onClick={rightToggle.disabled ? undefined : rightToggle.onClick}
                disabled={rightToggle.disabled}
                title={rightToggle.title}
                className={`icon-btn p-1.5 ${rightToggle.active ? 'text-accent' : 'text-text-tertiary'} ${rightToggle.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <PanelRight className="w-4 h-4" />
              </button>
            )}
            {onNewChat && (
              <button
                onClick={onNewChat}
                title="New chat"
                className="icon-btn p-1.5 text-text-tertiary"
              >
                <SquarePen className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

    </header>
  );
}

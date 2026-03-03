'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Check, X, Map, PanelLeft, PanelRight, SquareCode } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import type { RightPanelMode } from './EditorSidePanel';

interface ProjectHeaderProps {
  initiative: Initiative;
  onTitleUpdate?: (title: string) => void;
  rightPanel?: RightPanelMode;
  onToggleRightPanel?: () => void;
  hasProjectPlan?: boolean;
  hasEditorContent?: boolean;
  showChatPanel?: boolean;
  onToggleChatPanel?: () => void;
  showInspector?: boolean;
  hasInspectorItem?: boolean;
  onToggleInspector?: () => void;
}

export function ProjectHeader({ initiative, onTitleUpdate, rightPanel = 'closed', onToggleRightPanel, hasProjectPlan = false, hasEditorContent = false, showChatPanel = true, onToggleChatPanel, showInspector = false, hasInspectorItem = false, onToggleInspector }: ProjectHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(
    initiative.title || 'New Project'
  );
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update local title state when initiative changes (e.g., switching projects or title is generated)
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
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <header className="flex-shrink-0 bg-white">
      <div className="px-4 py-[7px] flex items-center relative">
        {/* Back button */}
        <Link 
          href="/" 
          className="icon-btn flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-text-secondary" />
        </Link>

        {/* Left: panel toggles */}
        {rightPanel !== 'closed' && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={onToggleChatPanel}
              title={showChatPanel ? 'Hide chat panel' : 'Show chat panel'}
              className={`icon-btn p-1.5 ${showChatPanel ? 'text-accent' : 'text-text-tertiary'}`}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            {rightPanel === 'project_plan' && (
              <button
                onClick={hasInspectorItem ? onToggleInspector : undefined}
                disabled={!hasInspectorItem}
                title={showInspector ? 'Hide inspector' : 'Show inspector'}
                className={`icon-btn p-1.5 ${showInspector ? 'text-accent' : 'text-text-tertiary'} ${!hasInspectorItem ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <PanelRight className="w-4 h-4" />
              </button>
            )}
          </div>
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
                  className="min-w-0 px-0 py-0.5 text-sm font-normal text-text-primary bg-transparent border-0 border-b border-accent rounded-none focus:outline-none focus:ring-0 text-center"
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
                <h1 className="text-sm font-normal text-text-primary truncate">
                  {title}
                </h1>
                <button
                  onClick={() => setIsEditing(true)}
                  className="icon-btn p-1 opacity-0 group-hover:opacity-100 text-text-tertiary"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-1">
          {/* Dynamic right-panel pill button */}
          {onToggleRightPanel && (hasProjectPlan || hasEditorContent) && (() => {
            let label: string;
            let icon: React.ReactNode;
            let isSelected: boolean;

            if (rightPanel === 'closed') {
              label = hasProjectPlan ? 'Project Plan' : 'Editor';
              icon = hasProjectPlan ? <Map className="w-3.5 h-3.5" /> : <SquareCode className="w-3.5 h-3.5" />;
              isSelected = false;
            } else if (rightPanel === 'project_plan') {
              if (hasEditorContent) {
                label = 'Editor';
                icon = <SquareCode className="w-3.5 h-3.5" />;
                isSelected = false;
              } else {
                label = 'Project Plan';
                icon = <Map className="w-3.5 h-3.5" />;
                isSelected = true;
              }
            } else {
              if (hasProjectPlan) {
                label = 'Project Plan';
                icon = <Map className="w-3.5 h-3.5" />;
                isSelected = false;
              } else {
                label = 'Editor';
                icon = <SquareCode className="w-3.5 h-3.5" />;
                isSelected = true;
              }
            }

            return (
              <button
                onClick={onToggleRightPanel}
                className={`pill-btn !px-2.5 !py-1.5 !text-xs ml-1 ${isSelected ? 'selected' : ''}`}
              >
                {icon}
                {label}
              </button>
            );
          })()}
        </div>
      </div>

      {/* Accent divider */}
      <div className="divider-accent" />
    </header>
  );
}

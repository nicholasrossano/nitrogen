'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Pencil,
  Check,
  X,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  SquarePen,
  ArrowLeft,
  Users,
  MessageSquare,
} from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { ShareProjectModal } from '@/components/sharing/ShareProjectModal';

type HeaderIcon = 'panel-left' | 'panel-right' | 'chat' | 'workspace';

interface PanelToggle {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  icon?: HeaderIcon;
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
  /** Override the tooltip for the onNewChat button (default: "New chat") */
  newChatTitle?: string;
  /** ArrowLeft back button — shown on the left side when provided */
  onBack?: () => void;
  /** Hide editing controls for read-only viewers */
  readOnly?: boolean;
}

export function ProjectHeader({
  initiative,
  onTitleUpdate,
  leftToggle,
  rightToggle,
  onNewChat,
  newChatTitle = 'New chat',
  onBack,
  readOnly = false,
}: ProjectHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initiative.title || 'New Project');
  const [saving, setSaving] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOwner = !initiative.shared_role;
  const canShare = isOwner || initiative.shared_role === 'editor';

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
    } catch (error) {
      console.error('Failed to update title:', error);
      setTitle(initiative.title || 'New Project');
    } finally {
      setSaving(false);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setTitle(initiative.title || 'New Project');
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    else if (e.key === 'Escape') handleCancel();
  };

  const renderPanelIcon = (icon: HeaderIcon | undefined, fallback: 'left' | 'right') => {
    switch (icon) {
      case 'chat':
        return <MessageSquare className="w-4 h-4" />;
      case 'workspace':
        return <PanelsTopLeft className="w-4 h-4" />;
      case 'panel-right':
        return <PanelRight className="w-4 h-4" />;
      case 'panel-left':
      default:
        return fallback === 'left'
          ? <PanelLeft className="w-4 h-4" />
          : <PanelRight className="w-4 h-4" />;
    }
  };

  const hasRightControls = onNewChat || leftToggle || rightToggle || canShare || initiative.shared_role;

  return (
    <header className="flex-shrink-0">
      <div className="px-4 h-14 flex items-center relative">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              title="Back"
              className="icon-btn p-1.5 text-text-tertiary"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Editable title — centered */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            {isEditing && !readOnly ? (
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
                {!readOnly && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="icon-btn p-1 opacity-0 group-hover:opacity-100 text-text-tertiary"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                {initiative.shared_role === 'viewer' && (
                  <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-text-tertiary bg-surface-subtle rounded">
                    View only
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right controls: share + panel toggles + new chat */}
        {hasRightControls && (
          <div className="ml-auto flex items-center gap-1">
            {canShare && (
              <button
                onClick={() => setShowShareModal(true)}
                className="flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg border border-stroke-subtle bg-white text-text-secondary hover:border-accent hover:text-accent transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                Share
              </button>
            )}
            {leftToggle && (
              <button
                onClick={leftToggle.disabled ? undefined : leftToggle.onClick}
                disabled={leftToggle.disabled}
                title={leftToggle.title}
                className={`icon-btn p-1.5 ${leftToggle.active ? 'text-accent' : 'text-text-tertiary'} ${leftToggle.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {renderPanelIcon(leftToggle.icon, 'left')}
              </button>
            )}
            {rightToggle && (
              <button
                onClick={rightToggle.disabled ? undefined : rightToggle.onClick}
                disabled={rightToggle.disabled}
                title={rightToggle.title}
                className={`icon-btn p-1.5 ${rightToggle.active ? 'text-accent' : 'text-text-tertiary'} ${rightToggle.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {renderPanelIcon(rightToggle.icon, 'right')}
              </button>
            )}
            {onNewChat && (
              <button
                onClick={onNewChat}
                title={newChatTitle}
                className="icon-btn p-1.5 text-text-tertiary"
              >
                <SquarePen className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {showShareModal && (
        <ShareProjectModal
          initiativeId={initiative.id}
          ownerEmail={initiative.owner_email}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </header>
  );
}

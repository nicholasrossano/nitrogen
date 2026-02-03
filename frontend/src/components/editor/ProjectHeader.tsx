'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Check, X } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { getIconByName } from '@/lib/icons';

interface ProjectHeaderProps {
  initiative: Initiative;
  onTitleUpdate?: (title: string) => void;
}

export function ProjectHeader({ initiative, onTitleUpdate }: ProjectHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(
    initiative.title || 'Untitled'
  );
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const IconComponent = getIconByName(initiative.icon);

  // Update local title state when initiative changes (e.g., switching projects or title is generated)
  useEffect(() => {
    setTitle(initiative.title || 'Untitled');
  }, [initiative.id, initiative.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (!title.trim()) {
      setTitle(initiative.title || 'Untitled');
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
    setTitle(initiative.title || 'Untitled');
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
      <div className="px-4 py-2 flex items-center gap-2">
        {/* Back button */}
        <Link 
          href="/" 
          className="icon-btn"
        >
          <ArrowLeft className="w-4 h-4 text-text-secondary" />
        </Link>

        {/* Project icon */}
        <div className="w-6 h-6 bg-accent-wash rounded flex items-center justify-center flex-shrink-0">
          <IconComponent className="w-3 h-3 text-accent" />
        </div>

        {/* Editable title */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ width: `${Math.max(title.length + 2, 12)}ch` }}
                className="min-w-0 px-0 py-0.5 text-sm font-semibold text-text-primary bg-transparent border-0 border-b border-accent rounded-none focus:outline-none focus:ring-0"
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
            <div className="flex items-center gap-1.5 min-w-0 group">
              <h1 className="text-sm font-semibold text-text-primary truncate">
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

      {/* Accent divider */}
      <div className="divider-accent" />
    </header>
  );
}

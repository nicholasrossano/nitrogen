'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Check, X, FolderOpen } from 'lucide-react';
import { api, Initiative } from '@/lib/api';

interface ProjectHeaderProps {
  initiative: Initiative;
  onTitleUpdate?: (title: string) => void;
}

export function ProjectHeader({ initiative, onTitleUpdate }: ProjectHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(
    initiative.title || initiative.project_description?.slice(0, 50) || 'Untitled Project'
  );
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (!title.trim()) {
      setTitle(initiative.title || 'Untitled Project');
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
    setTitle(initiative.title || initiative.project_description?.slice(0, 50) || 'Untitled Project');
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
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Back button */}
        <Link 
          href="/" 
          className="p-2 hover:bg-surface-subtle rounded transition-colors duration-150"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>

        {/* Project icon */}
        <div className="w-8 h-8 bg-accent-wash rounded flex items-center justify-center flex-shrink-0">
          <FolderOpen className="w-4 h-4 text-accent" />
        </div>

        {/* Editable title */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 px-2 py-1 text-lg font-semibold text-text-primary bg-surface-subtle border border-stroke-accent rounded focus:outline-none focus:ring-1 focus:ring-accent"
                disabled={saving}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="p-1.5 hover:bg-indicator-green/10 rounded text-indicator-green transition-colors"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="p-1.5 hover:bg-surface-subtle rounded text-text-tertiary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0 group">
              <h1 className="text-lg font-semibold text-text-primary truncate">
                {title}
              </h1>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-surface-subtle rounded text-text-tertiary transition-all"
              >
                <Pencil className="w-4 h-4" />
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

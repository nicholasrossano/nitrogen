'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface DuplicateEntry {
  original: string;
  renamed: string;
}

interface DuplicateFileDialogProps {
  duplicates: DuplicateEntry[];
  /** How many non-duplicate files were already uploaded before this dialog appeared. */
  cleanCount?: number;
  /** Called with the original names of files the user chose to upload. */
  onConfirm: (selectedOriginals: string[]) => void;
  onCancel: () => void;
}

export function DuplicateFileDialog({
  duplicates,
  cleanCount = 0,
  onConfirm,
  onCancel,
}: DuplicateFileDialogProps) {
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(duplicates.map((d) => d.original)),
  );

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onCancel, 150);
  };

  const handleConfirm = () => {
    setVisible(false);
    setTimeout(() => onConfirm(Array.from(checked)), 150);
  };

  const toggle = (original: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(original) ? next.delete(original) : next.add(original);
      return next;
    });
  };

  const allChecked = checked.size === duplicates.length;
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(duplicates.map((d) => d.original)));

  const uploadCount = checked.size;

  const modal = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-white shadow-2xl border border-stroke-subtle flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">
              {duplicates.length === 1 ? 'Duplicate file name' : 'Duplicate file names'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          {cleanCount > 0 && (
            <p className="text-xs text-text-tertiary bg-surface-subtle rounded-lg px-3 py-2">
              {cleanCount === 1
                ? '1 other file from your selection is uploading in the background.'
                : `${cleanCount} other files from your selection are uploading in the background.`}
            </p>
          )}
          <p className="text-sm text-text-secondary">
            {duplicates.length === 1
              ? 'This file already exists in this project.'
              : `These ${duplicates.length} files already exist in this project.`}{' '}
            <span className="text-text-tertiary">
              Files you choose to upload will be renamed automatically.
            </span>
          </p>

          {/* Select all row */}
          <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-subtle cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
            />
            <span className="text-xs font-medium text-text-secondary">
              {allChecked ? 'Deselect all' : 'Select all'}
            </span>
          </label>

          {/* File list */}
          <div className="rounded-lg border border-stroke-subtle divide-y divide-stroke-subtle overflow-hidden">
            {duplicates.map((d) => (
              <label
                key={d.original}
                className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-subtle/60 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={checked.has(d.original)}
                  onChange={() => toggle(d.original)}
                  className="w-3.5 h-3.5 rounded accent-accent cursor-pointer flex-shrink-0"
                />
                <span className="text-xs text-text-primary truncate">{d.original}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-3 border-t border-stroke-subtle flex-shrink-0">
          <button onClick={handleClose} className="btn-secondary text-sm">
            Skip duplicates
          </button>
          <button
            onClick={handleConfirm}
            disabled={uploadCount === 0}
            className="btn-primary text-sm"
          >
            {uploadCount === 0
              ? 'Upload'
              : uploadCount === 1
              ? 'Upload 1 file'
              : `Upload ${uploadCount} files`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

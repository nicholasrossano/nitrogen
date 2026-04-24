'use client';

import type { ReactNode } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import {
  sideDrawerUploadActionButtonClass,
  uploadDropzoneBaseClass,
  uploadDropzoneDraggingClass,
  uploadDropzoneIdleClass,
} from '@/components/upload/uploadButtonStyles';

interface UploadDropzoneProps {
  isDragging: boolean;
  uploading: boolean;
  onClick: () => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  dragLabel: string;
  idleLabel: string;
  subLabel?: string;
  className?: string;
}

export function UploadDropzone({
  isDragging,
  uploading,
  onClick,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  dragLabel,
  idleLabel,
  subLabel,
  className = '',
}: UploadDropzoneProps) {
  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className={`
        ${uploadDropzoneBaseClass}
        ${isDragging ? uploadDropzoneDraggingClass : uploadDropzoneIdleClass}
        ${uploading ? 'pointer-events-none opacity-60' : ''}
        ${className}
      `}
    >
      {uploading ? (
        <>
          <Loader2 className="w-4 h-4 text-text-secondary animate-spin" />
          <span className="text-[11px] text-text-secondary">Uploading…</span>
        </>
      ) : (
        <>
          <FileUp className={`w-4 h-4 ${isDragging ? 'text-accent' : 'text-text-secondary'}`} />
          <div className="text-center">
            <span className={`text-[11px] ${isDragging ? 'text-accent' : 'text-text-secondary'}`}>
              {isDragging ? dragLabel : idleLabel}
            </span>
            {!isDragging && subLabel ? (
              <p className="text-[10px] text-text-tertiary mt-0.5">{subLabel}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

interface UploadActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  className?: string;
}

export function UploadActionButton({
  onClick,
  disabled = false,
  icon,
  label,
  className = '',
}: UploadActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${sideDrawerUploadActionButtonClass} ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}

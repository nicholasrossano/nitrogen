'use client';

import type { BuildItem } from '@/lib/api';
import { ItemToolbar } from './ItemToolbar';
import { GripVertical } from 'lucide-react';

interface AssessmentItemProps {
  item: BuildItem;
  children: React.ReactNode;
  onDelete?: () => void;
  onAddToChat?: (item: BuildItem) => void;
  className?: string;
  dragHandleProps?: Record<string, any>;
  isDragging?: boolean;
}

export function AssessmentItem({
  item,
  children,
  onDelete,
  onAddToChat,
  className = '',
  dragHandleProps,
  isDragging,
}: AssessmentItemProps) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-2.5 rounded-lg transition-colors ${
        isDragging
          ? 'bg-surface-subtle shadow-lg opacity-80'
          : 'border border-transparent'
      } ${className}`}
    >
      {/* Drag handle — hidden when no drag props are provided (read-only) */}
      {dragHandleProps && (
        <div
          {...dragHandleProps}
          className="shrink-0 text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">{children}</div>

      {/* Toolbar — always visible */}
      <ItemToolbar
        item={item}
        onDelete={onDelete}
        onAddToChat={onAddToChat}
      />
    </div>
  );
}

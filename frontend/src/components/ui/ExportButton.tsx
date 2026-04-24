'use client';

import { Download, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

interface ExportButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  label?: string;
}

const BASE_EXPORT_BUTTON_CLASS =
  'btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 flex items-center shrink-0';

export function ExportButton({
  loading = false,
  label = 'Export',
  className = '',
  disabled,
  ...props
}: ExportButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`${BASE_EXPORT_BUTTON_CLASS}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
      {label}
    </button>
  );
}

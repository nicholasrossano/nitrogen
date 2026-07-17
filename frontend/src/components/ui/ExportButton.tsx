'use client';

import { Download, FileText, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ExportButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  label?: string;
  /** Defaults to download icon; pass file-text for narrative Report actions. */
  icon?: ReactNode;
}

const BASE_EXPORT_BUTTON_CLASS =
  'btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 flex items-center shrink-0';

export function ExportButton({
  loading = false,
  label = 'Export',
  icon,
  className = '',
  disabled,
  ...props
}: ExportButtonProps) {
  const leading = icon ?? <Download className="w-3 h-3" />;
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`${BASE_EXPORT_BUTTON_CLASS}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : leading}
      {label}
    </button>
  );
}

export function ReportButton(props: Omit<ExportButtonProps, 'icon' | 'label'> & { label?: string }) {
  const { label = 'Report', ...rest } = props;
  return (
    <ExportButton
      {...rest}
      label={label}
      icon={<FileText className="w-3 h-3" />}
    />
  );
}

import { Check } from 'lucide-react';
import { clsx } from 'clsx';

import { Button } from './Button';

interface ConfirmButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  loadingLabel?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
}

export function ConfirmButton({
  onClick,
  disabled = false,
  loading = false,
  label = 'Confirm',
  loadingLabel = 'Confirming...',
  className,
  size = 'sm',
  type = 'button',
}: ConfirmButtonProps) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      size={size}
      className={clsx('!text-xs !px-4 !py-1.5', className)}
    >
      {!loading && <Check className="h-3.5 w-3.5" />}
      {loading ? loadingLabel : label}
    </Button>
  );
}

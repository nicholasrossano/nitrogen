'use client';

import { forwardRef } from 'react';

interface EmailAddressFieldProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
}

export const EmailAddressField = forwardRef<HTMLInputElement, EmailAddressFieldProps>(
  function EmailAddressField(
    {
      value,
      onChange,
      onKeyDown,
      placeholder = 'Email address',
      className = 'flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-stroke-subtle bg-white focus:outline-none focus:ring-1 focus:ring-accent',
    },
    ref,
  ) {
    return (
      <input
        ref={ref}
        type="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="email"
        className={className}
      />
    );
  },
);

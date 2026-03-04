'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { AccessCodeGate } from '@/components/AccessCodeGate';

interface ProvidersProps {
  children: ReactNode;
}

// Set NEXT_PUBLIC_USE_ACCESS_CODE=true to enable the access-code gate instead of email auth.
const USE_ACCESS_CODE = process.env.NEXT_PUBLIC_USE_ACCESS_CODE === 'true';

export function Providers({ children }: ProvidersProps) {
  if (USE_ACCESS_CODE) {
    return (
      <AccessCodeGate>
        <AuthProvider>
          {children}
        </AuthProvider>
      </AccessCodeGate>
    );
  }

  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}

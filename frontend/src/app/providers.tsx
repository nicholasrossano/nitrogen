'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { AccessCodeGate } from '@/components/AccessCodeGate';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AccessCodeGate>
      <AuthProvider>
        {children}
      </AuthProvider>
    </AccessCodeGate>
  );
}

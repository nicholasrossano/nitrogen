'use client';

import { PageLoader } from './PageLoader';

interface WorkspaceTabLoaderProps {
  label?: string;
  className?: string;
}

export function WorkspaceTabLoader({
  label = '',
  className = '',
}: WorkspaceTabLoaderProps) {
  return (
    <div className={['flex h-full w-full min-h-64 items-center justify-center', className].join(' ').trim()}>
      <PageLoader label={label} />
    </div>
  );
}

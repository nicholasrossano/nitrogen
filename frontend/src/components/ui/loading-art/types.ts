import type { ComponentType } from 'react';

export interface LoadingArtProps {
  size?: number;
  className?: string;
  color?: string;
}

export interface LoadingArtDefinition {
  id: string;
  name: string;
  description?: string;
  Component: ComponentType<LoadingArtProps>;
}

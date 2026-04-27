'use client';

import { useState, useEffect } from 'react';
import { Check, Search, FileText, Save } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { UniversalLoadingIcon } from '@/components/ui/PageLoader';

export interface GeneratingStep {
  label: string;
  icon: LucideIcon;
  duration: number; // seconds
}

export const ALIGNMENT_STEPS: GeneratingStep[] = [
  { label: 'Confirming outline',       icon: Check,    duration: 3  },
  { label: 'Retrieving project evidence', icon: Search, duration: 18 },
  { label: 'Writing deliverables',     icon: FileText, duration: 75 },
  { label: 'Saving results',           icon: Save,     duration: 30 },
];

export const MODEL_INPUTS_STEPS: GeneratingStep[] = [
  { label: 'Collecting project data',  icon: Search,   duration: 8  },
  { label: 'Populating inputs',        icon: FileText, duration: 22 },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`;
}

interface WidgetGeneratingProgressProps {
  steps?: GeneratingStep[];
  subtitle?: string;
}

export function WidgetGeneratingProgress({
  steps = ALIGNMENT_STEPS,
  subtitle = 'This usually takes 2–3 minutes',
}: WidgetGeneratingProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  let accumulated = 0;
  let currentStep = steps.length - 1;
  for (let i = 0; i < steps.length; i++) {
    if (elapsed < accumulated + steps[i].duration) {
      currentStep = i;
      break;
    }
    accumulated += steps[i].duration;
  }

  const totalExpected = steps.reduce((s, step) => s + step.duration, 0);
  const progress = Math.min(94, (elapsed / totalExpected) * 94);

  const StepIcon = steps[currentStep].icon;

  return (
    <div className="px-5 py-10 flex flex-col items-center gap-5">
      <div className="relative flex items-center justify-center w-10 h-10">
        <UniversalLoadingIcon size={40} />
        <StepIcon className="absolute w-4.5 h-4.5 text-accent" />
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-text-primary">
          {steps[currentStep].label}...
        </p>
        <p className="text-xs text-text-tertiary mt-1">{subtitle}</p>
      </div>

      <div className="w-full max-w-[240px]">
        <div className="h-1 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-6">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                i < currentStep
                  ? 'bg-accent'
                  : i === currentStep
                    ? 'bg-accent animate-pulse'
                    : 'bg-zinc-200'
              }`}
            />
            <span
              className={`text-[10px] transition-colors duration-300 ${
                i <= currentStep ? 'text-text-secondary' : 'text-text-tertiary'
              }`}
            >
              {step.label.split(' ').slice(0, 2).join(' ')}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-text-tertiary">
        {formatElapsed(elapsed)} elapsed
      </p>
    </div>
  );
}

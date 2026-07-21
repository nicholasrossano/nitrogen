'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SHELL_SURFACE_HEADER_HEIGHT } from '@/components/ui/chatSidebarLayout';
import { floatTabDedupeKey } from '@/lib/floatTabSession';
import { getFloatWidgetTitle, type FloatWidget } from './FloatLayer';

interface FloatTabBarProps {
  tabs: FloatWidget[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export function FloatTabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: FloatTabBarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeTabId, tabs.length]);

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex w-full shrink-0 items-center"
      style={{ height: SHELL_SURFACE_HEADER_HEIGHT }}
      role="tablist"
      aria-label="Open floats"
    >
      <div
        ref={scrollerRef}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const tabId = floatTabDedupeKey(tab);
          const isActive = tabId === activeTabId;
          const title = getFloatWidgetTitle(tab);

          return (
            <div
              key={tabId}
              // Hover styles only on fine pointers — touch sticky-hover otherwise eats the first tap.
              className={`group relative flex h-8 max-w-[11rem] shrink-0 items-center rounded-lg border transition-colors ${
                isActive
                  ? 'border-stroke-subtle bg-white text-text-primary shadow-floating-panel'
                  : 'border-transparent bg-black/[0.04] text-text-secondary [@media(hover:hover)]:hover:bg-black/[0.07] [@media(hover:hover)]:hover:text-text-primary'
              }`}
            >
              <button
                ref={isActive ? activeRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={title}
                // Avoid stealing focus from editors on desktop; preventDefault on touch delays click.
                onPointerDown={(event) => {
                  if (event.pointerType === 'touch') return;
                  event.preventDefault();
                }}
                onClick={() => onActivate(tabId)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onClose(tabId);
                  }
                }}
                className="min-w-0 flex-1 truncate py-1.5 pl-2.5 pr-6 text-left text-[11px] font-medium leading-none"
              >
                {title}
              </button>
              <button
                type="button"
                aria-label={`Close ${title}`}
                title="Close"
                onPointerDown={(event) => {
                  if (event.pointerType === 'touch') return;
                  event.preventDefault();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tabId);
                }}
                className={`absolute right-0.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary transition-opacity [@media(hover:hover)]:hover:bg-black/[0.08] [@media(hover:hover)]:hover:text-text-primary ${
                  isActive
                    ? 'opacity-70'
                    // Hidden inactive close must not intercept taps (opacity-0 still hit-tests).
                    : 'pointer-events-none opacity-0 max-md:pointer-events-auto max-md:opacity-70 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100'
                }`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

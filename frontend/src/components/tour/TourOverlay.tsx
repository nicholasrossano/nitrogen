'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  getTourAnchorRect,
  subscribeTourAnchors,
} from '@/components/tour/tourRegistry';
import {
  getStepsForGroup,
  getTourStep,
  type TourPlacement,
} from '@/lib/tour/tourSteps';
import { useTourStore } from '@/stores/tourStore';

const EDGE_PAD = 12;
const GAP = 10;
/** Pulsing marker size — sits in the top-right of each tour target. */
const DOT_SIZE = 14;
const DOT_INSET = 6;

interface DotLayout {
  id: string;
  left: number;
  top: number;
  size: number;
}

interface PopoverLayout {
  left: number;
  top: number;
  placement: TourPlacement;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function measureDot(id: string): DotLayout | null {
  const rect = getTourAnchorRect(id);
  if (!rect) return null;
  // Top-right corner of the widget, slightly inset so it reads as belonging to that control.
  return {
    id,
    left: rect.right - DOT_SIZE - DOT_INSET,
    top: rect.top + DOT_INSET,
    size: DOT_SIZE,
  };
}

function placePopover(
  anchor: DOMRect,
  tipWidth: number,
  tipHeight: number,
  preferred: TourPlacement = 'auto',
): PopoverLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const candidates: TourPlacement[] =
    preferred === 'auto'
      ? ['bottom', 'top', 'right', 'left']
      : [preferred, 'bottom', 'top', 'right', 'left'];

  for (const placement of candidates) {
    let left = 0;
    let top = 0;
    if (placement === 'bottom') {
      left = anchor.left + anchor.width / 2 - tipWidth / 2;
      top = anchor.bottom + GAP;
    } else if (placement === 'top') {
      left = anchor.left + anchor.width / 2 - tipWidth / 2;
      top = anchor.top - tipHeight - GAP;
    } else if (placement === 'right') {
      left = anchor.right + GAP;
      top = anchor.top + anchor.height / 2 - tipHeight / 2;
    } else {
      left = anchor.left - tipWidth - GAP;
      top = anchor.top + anchor.height / 2 - tipHeight / 2;
    }

    left = Math.max(EDGE_PAD, Math.min(left, vw - tipWidth - EDGE_PAD));
    top = Math.max(EDGE_PAD, Math.min(top, vh - tipHeight - EDGE_PAD));

    const fitsVertically =
      (placement === 'bottom' && anchor.bottom + GAP + tipHeight <= vh - EDGE_PAD) ||
      (placement === 'top' && anchor.top - GAP - tipHeight >= EDGE_PAD) ||
      placement === 'left' ||
      placement === 'right';
    const fitsHorizontally =
      (placement === 'right' && anchor.right + GAP + tipWidth <= vw - EDGE_PAD) ||
      (placement === 'left' && anchor.left - GAP - tipWidth >= EDGE_PAD) ||
      placement === 'top' ||
      placement === 'bottom';

    if (fitsVertically && fitsHorizontally) {
      return { left, top, placement };
    }
  }

  return {
    left: Math.max(EDGE_PAD, Math.min(anchor.left, vw - tipWidth - EDGE_PAD)),
    top: Math.max(EDGE_PAD, Math.min(anchor.bottom + GAP, vh - tipHeight - EDGE_PAD)),
    placement: 'bottom',
  };
}

export function TourOverlay() {
  const activeGroup = useTourStore((s) => s.activeGroup);
  const activeStepId = useTourStore((s) => s.activeStepId);
  const welcomeActive = useTourStore((s) => s.welcomeActive);
  const completedStepIds = useTourStore((s) => s.completedStepIds);
  const setActiveStep = useTourStore((s) => s.setActiveStep);
  const markStepCompleted = useTourStore((s) => s.markStepCompleted);
  const finishWelcome = useTourStore((s) => s.finishWelcome);
  const skipWelcome = useTourStore((s) => s.skipWelcome);
  const dismissActiveGroup = useTourStore((s) => s.dismissActiveGroup);

  const [mounted, setMounted] = useState(false);
  const [dots, setDots] = useState<DotLayout[]>([]);
  const [popover, setPopover] = useState<PopoverLayout | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [popoverEl, setPopoverEl] = useState<HTMLDivElement | null>(null);
  const popoverElRef = useRef<HTMLDivElement | null>(null);
  const lastStepIdRef = useRef<string | null>(null);
  const moveCleanupRef = useRef<number | null>(null);
  const isAnimatingMoveRef = useRef(false);

  const assignPopoverEl = useCallback((el: HTMLDivElement | null) => {
    popoverElRef.current = el;
    setPopoverEl(el);
  }, []);

  useEffect(() => {
    setMounted(true);
    setReducedMotion(prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!activeGroup) {
      lastStepIdRef.current = null;
      isAnimatingMoveRef.current = false;
      if (moveCleanupRef.current != null) {
        window.clearTimeout(moveCleanupRef.current);
        moveCleanupRef.current = null;
      }
    }
  }, [activeGroup]);

  const groupSteps = useMemo(
    () => (activeGroup ? getStepsForGroup(activeGroup) : []),
    [activeGroup],
  );

  const availableStepIds = useMemo(() => {
    return groupSteps
      .map((s) => s.id)
      .filter((id) => Boolean(getTourAnchorRect(id)))
      // Deferred welcome tips reuse group=welcome after welcomeCompleted — hide
      // already-finished chrome tips so only newly-visible widgets are tagged.
      .filter((id) => !completedStepIds.includes(id) || id === activeStepId);
  }, [activeStepId, completedStepIds, groupSteps, dots]);

  const activeStep = activeStepId ? getTourStep(activeStepId) : undefined;
  const activeIndex = activeStepId ? availableStepIds.indexOf(activeStepId) : -1;
  const stepCount = availableStepIds.length;

  const computePopoverLayout = useCallback((stepId: string, tipEl: HTMLDivElement): PopoverLayout | null => {
    const rect = getTourAnchorRect(stepId);
    if (!rect) return null;
    const pulseRect = new DOMRect(
      rect.right - DOT_SIZE - DOT_INSET,
      rect.top + DOT_INSET,
      DOT_SIZE,
      DOT_SIZE,
    );
    const tip = tipEl.getBoundingClientRect();
    const step = getTourStep(stepId);
    return placePopover(pulseRect, tip.width, tip.height, step?.placement ?? 'auto');
  }, []);

  const remeasureDots = useCallback(() => {
    if (!activeGroup) {
      setDots([]);
      return;
    }
    const steps = getStepsForGroup(activeGroup);
    const completed = useTourStore.getState().completedStepIds;
    const currentActive = useTourStore.getState().activeStepId;
    const nextDots: DotLayout[] = [];
    for (const step of steps) {
      if (completed.includes(step.id) && step.id !== currentActive) continue;
      const dot = measureDot(step.id);
      if (dot) nextDots.push(dot);
    }
    setDots(nextDots);
  }, [activeGroup]);

  /** Snap popover without animation (scroll/resize). */
  const snapPopover = useCallback(() => {
    if (isAnimatingMoveRef.current) return;
    const tipEl = popoverElRef.current;
    const stepId = useTourStore.getState().activeStepId;
    if (!tipEl || !stepId) {
      setPopover(null);
      return;
    }
    const next = computePopoverLayout(stepId, tipEl);
    if (!next) {
      setPopover(null);
      return;
    }
    tipEl.style.transition = 'none';
    tipEl.style.transform = '';
    tipEl.style.left = `${next.left}px`;
    tipEl.style.top = `${next.top}px`;
    tipEl.style.opacity = '1';
    setPopover(next);
  }, [computePopoverLayout]);

  /**
   * Move popover to the active step. On step change, FLIP-animate via transform
   * so the motion starts from the previous painted position.
   */
  const movePopoverToStep = useCallback((stepId: string, animate: boolean) => {
    const tipEl = popoverElRef.current;
    if (!tipEl) return;
    const next = computePopoverLayout(stepId, tipEl);
    if (!next) {
      setPopover(null);
      return;
    }

    if (moveCleanupRef.current != null) {
      window.clearTimeout(moveCleanupRef.current);
      moveCleanupRef.current = null;
    }

    if (!animate || reducedMotion) {
      isAnimatingMoveRef.current = false;
      tipEl.style.transition = 'none';
      tipEl.style.transform = '';
      tipEl.style.left = `${next.left}px`;
      tipEl.style.top = `${next.top}px`;
      tipEl.style.opacity = '1';
      setPopover(next);
      return;
    }

    const first = tipEl.getBoundingClientRect();
    tipEl.style.transition = 'none';
    tipEl.style.transform = '';
    tipEl.style.left = `${next.left}px`;
    tipEl.style.top = `${next.top}px`;
    tipEl.style.opacity = '1';
    const last = tipEl.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      setPopover(next);
      return;
    }

    isAnimatingMoveRef.current = true;
    tipEl.style.transform = `translate(${dx}px, ${dy}px)`;
    // Force layout so the browser commits the inverted position before animating.
    tipEl.getBoundingClientRect();
    tipEl.style.transition = 'transform 280ms ease-out';
    tipEl.style.transform = 'translate(0, 0)';
    setPopover(next);

    moveCleanupRef.current = window.setTimeout(() => {
      if (popoverElRef.current === tipEl) {
        tipEl.style.transition = 'none';
        tipEl.style.transform = '';
      }
      isAnimatingMoveRef.current = false;
      moveCleanupRef.current = null;
    }, 300);
  }, [computePopoverLayout, reducedMotion]);

  useLayoutEffect(() => {
    remeasureDots();
    if (!activeGroup || !activeStepId || !popoverEl) {
      setPopover(null);
      return;
    }

    const stepChanged = lastStepIdRef.current !== activeStepId;
    const hadPriorStep = lastStepIdRef.current != null;
    lastStepIdRef.current = activeStepId;
    movePopoverToStep(activeStepId, stepChanged && hadPriorStep);
  }, [activeGroup, activeStepId, movePopoverToStep, popoverEl, remeasureDots, welcomeActive]);

  useEffect(() => {
    if (!activeGroup) return;
    const onChange = () => {
      remeasureDots();
      snapPopover();
    };
    const unsub = subscribeTourAnchors(onChange);
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    const interval = window.setInterval(onChange, 500);
    return () => {
      unsub();
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      window.clearInterval(interval);
    };
  }, [activeGroup, remeasureDots, snapPopover]);

  // If the active target disappears, hop to the next available step in the group.
  useEffect(() => {
    if (!activeGroup || !activeStepId) return;
    if (availableStepIds.includes(activeStepId)) return;
    if (availableStepIds.length === 0) {
      if (activeGroup !== 'welcome') {
        dismissActiveGroup();
      }
      return;
    }
    // During welcome, wait until a few chrome targets exist — otherwise a single early
    // survivor (e.g. context stack) can become a 1/1 tour before anchors settle.
    if (activeGroup === 'welcome' && availableStepIds.length < 3) return;
    setActiveStep(availableStepIds[0] ?? null);
  }, [activeGroup, activeStepId, availableStepIds, dismissActiveGroup, setActiveStep]);

  useEffect(() => {
    if (!activeGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeGroup === 'welcome' && welcomeActive) skipWelcome(availableStepIds);
        else dismissActiveGroup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGroup, availableStepIds, dismissActiveGroup, skipWelcome, welcomeActive]);

  const goRelative = useCallback(
    (delta: number) => {
      if (activeIndex < 0 || stepCount === 0) return;
      const nextIndex = activeIndex + delta;
      if (nextIndex < 0 || nextIndex >= stepCount) return;
      const nextId = availableStepIds[nextIndex];
      if (nextId) setActiveStep(nextId);
    },
    [activeIndex, availableStepIds, setActiveStep, stepCount],
  );

  const handleDone = useCallback(() => {
    if (activeStepId) markStepCompleted(activeStepId);
    if (activeGroup === 'welcome' && welcomeActive) {
      finishWelcome(availableStepIds);
      return;
    }
    dismissActiveGroup();
  }, [
    activeGroup,
    activeStepId,
    availableStepIds,
    dismissActiveGroup,
    finishWelcome,
    markStepCompleted,
    welcomeActive,
  ]);

  const handleSkip = useCallback(() => {
    if (activeGroup === 'welcome' && welcomeActive) {
      skipWelcome(availableStepIds);
      return;
    }
    dismissActiveGroup();
  }, [activeGroup, availableStepIds, dismissActiveGroup, skipWelcome, welcomeActive]);

  if (!mounted || !activeGroup || !activeStep) return null;

  const isWelcome = activeGroup === 'welcome';
  const isLast = activeIndex >= 0 && activeIndex === stepCount - 1;
  const isFirst = activeIndex <= 0;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[95]" aria-live="polite">
      {dots.map((dot) => {
        const isActive = dot.id === activeStepId;
        return (
          <button
            key={dot.id}
            type="button"
            aria-label={`Go to tip: ${getTourStep(dot.id)?.title ?? dot.id}`}
            aria-current={isActive ? 'step' : undefined}
            className={[
              'pointer-events-auto absolute rounded-full border-2 border-white bg-accent-anchor shadow-sm transition-[transform,opacity] duration-150',
              isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100',
              !reducedMotion && isActive ? 'tour-pulse-dot' : '',
              !reducedMotion && !isActive ? 'tour-pulse-dot-soft' : '',
            ].join(' ')}
            style={{
              left: dot.left,
              top: dot.top,
              width: isActive ? dot.size + 2 : dot.size,
              height: isActive ? dot.size + 2 : dot.size,
              // Keep active slightly larger without shifting the top-right visual origin.
              marginLeft: isActive ? -1 : 0,
              marginTop: isActive ? -1 : 0,
            }}
            onClick={() => setActiveStep(dot.id)}
          />
        );
      })}

      {activeStepId && (
        <div
          ref={assignPopoverEl}
          role="dialog"
          aria-labelledby="tour-popover-title"
          aria-describedby="tour-popover-body"
          className="pointer-events-auto fixed z-[96] w-[min(280px,calc(100vw-24px))] rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-lg will-change-transform"
          style={
            popover
              ? { left: popover.left, top: popover.top, opacity: 1 }
              : { left: -9999, top: -9999, opacity: 0 }
          }
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p id="tour-popover-title" className="text-xs font-semibold text-gray-800">
              {activeStep.title}
            </p>
            <button
              type="button"
              onClick={handleSkip}
              className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
              aria-label={isWelcome ? 'Skip tutorial' : 'Dismiss tip'}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p id="tour-popover-body" className="text-[11px] leading-relaxed text-gray-600">
            {activeStep.body}
          </p>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="text-[10px] tabular-nums text-gray-400">
              {activeIndex >= 0 ? `${activeIndex + 1} / ${stepCount}` : ''}
            </p>
            <div className="flex items-center gap-1">
              {isWelcome && (
                <button
                  type="button"
                  onClick={handleSkip}
                  className="mr-1 rounded px-1.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                >
                  Skip
                </button>
              )}
              <button
                type="button"
                disabled={isFirst}
                onClick={() => goRelative(-1)}
                className="rounded-md border border-gray-100 p-1 text-gray-600 transition-colors enabled:hover:bg-gray-50 disabled:cursor-default disabled:opacity-30"
                aria-label="Previous tip"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              {isLast || !isWelcome ? (
                <button
                  type="button"
                  onClick={handleDone}
                  className="rounded-md bg-accent-anchor px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:opacity-90"
                >
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => goRelative(1)}
                  className="rounded-md border border-gray-100 p-1 text-gray-600 transition-colors hover:bg-gray-50"
                  aria-label="Next tip"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

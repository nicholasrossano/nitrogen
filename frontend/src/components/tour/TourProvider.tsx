'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TourOverlay } from '@/components/tour/TourOverlay';
import {
  getTourAnchorElement,
  isTourAnchorRegistered,
  subscribeTourAnchors,
} from '@/components/tour/tourRegistry';
import {
  getStepsForGroup,
  MOUNT_TRIGGERED_FEATURE_STEPS,
  TOUR_STEPS,
  type TourGroup,
  WELCOME_STEP_IDS,
} from '@/lib/tour/tourSteps';
import { useTourStore } from '@/stores/tourStore';

const WELCOME_START_DELAY_MS = 900;
const MIN_WELCOME_ANCHORS = 2;

function firstAvailableWelcomeStepId(): string | null {
  for (const id of WELCOME_STEP_IDS) {
    if (isTourAnchorRegistered(id)) return id;
  }
  return null;
}

function availableWelcomeCount(): number {
  return WELCOME_STEP_IDS.filter((id) => isTourAnchorRegistered(id)).length;
}

function isFloorTourAnchor(id: string): boolean {
  const el = getTourAnchorElement(id);
  return el instanceof HTMLElement && el.dataset.tourSurface === 'floor';
}

function featureGroupForRoute(pathname: string, search: string): TourGroup | null {
  const normalized = search.startsWith('?') ? search : search ? `?${search}` : '';
  for (const step of TOUR_STEPS) {
    if (step.group === 'welcome') continue;
    // Floor tips (Overview / Variables / Files) only start when their floor header mounts.
    // Never start them from a sidebar-only / URL match — those chrome tips live in welcome.
    if (step.trigger === 'mount') continue;
    if (step.routeMatch?.(pathname, normalized)) return step.group;
  }
  return null;
}

/**
 * Owns auto-start of the welcome tour and first-visit feature tips.
 * Conservative: waits for anchors, never interrupts an active welcome tour.
 */
export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams.toString();

  const welcomeCompleted = useTourStore((s) => s.welcomeCompleted);
  const welcomeActive = useTourStore((s) => s.welcomeActive);
  const activeGroup = useTourStore((s) => s.activeGroup);
  const completedStepIds = useTourStore((s) => s.completedStepIds);
  const replayNonce = useTourStore((s) => s.replayNonce);
  const startWelcome = useTourStore((s) => s.startWelcome);
  const startFeatureGroup = useTourStore((s) => s.startFeatureGroup);

  const startedWelcomeRef = useRef(false);
  const promptedFeatureGroupsRef = useRef<Set<TourGroup>>(new Set());

  useEffect(() => {
    if (!welcomeCompleted) {
      startedWelcomeRef.current = false;
    }
  }, [welcomeCompleted, replayNonce]);

  useEffect(() => {
    // Fresh replay should be allowed to re-prompt floor tips later in the session.
    if (replayNonce > 0) {
      promptedFeatureGroupsRef.current = new Set();
    }
  }, [replayNonce]);

  // Auto-start welcome once enough anchors exist on the chat shell.
  useEffect(() => {
    if (welcomeCompleted || welcomeActive || startedWelcomeRef.current) return;
    if (!(pathname.startsWith('/chat') || pathname === '/' || pathname.startsWith('/projects/'))) return;
    // Replay has its own starter — avoid racing with a half-open floor/sidebar state.
    if (replayNonce > 0) return;

    let cancelled = false;
    let timer: number | null = null;

    const tryStart = () => {
      if (cancelled || startedWelcomeRef.current) return;
      const state = useTourStore.getState();
      if (state.welcomeCompleted || state.welcomeActive) return;
      if (availableWelcomeCount() < MIN_WELCOME_ANCHORS) return;
      const firstId = firstAvailableWelcomeStepId();
      if (!firstId) return;
      startedWelcomeRef.current = true;
      window.dispatchEvent(new CustomEvent('nitrogen:tour-expand-sidebar'));
      startWelcome(firstId);
    };

    timer = window.setTimeout(tryStart, WELCOME_START_DELAY_MS);
    const unsub = subscribeTourAnchors(() => {
      if (timer != null) return;
      timer = window.setTimeout(tryStart, 120);
    });

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      unsub();
    };
  }, [pathname, replayNonce, startWelcome, welcomeActive, welcomeCompleted]);

  // Replay: collapse floors, expand sidebar, wait for chrome anchors, then start welcome from step 1.
  useEffect(() => {
    if (replayNonce === 0) return;
    if (welcomeCompleted) return;

    const onWorkbench = pathname.startsWith('/chat') || pathname === '/' || pathname.startsWith('/projects/');
    if (!onWorkbench) {
      router.push('/chat');
      return;
    }

    let cancelled = false;
    let attempts = 0;

    window.dispatchEvent(new CustomEvent('nitrogen:tour-expand-sidebar'));
    window.dispatchEvent(new CustomEvent('nitrogen:tour-replay'));

    const tryStart = () => {
      if (cancelled) return;
      if (useTourStore.getState().welcomeActive) return;
      attempts += 1;
      if (availableWelcomeCount() < MIN_WELCOME_ANCHORS && attempts < 20) {
        window.setTimeout(tryStart, 150);
        return;
      }
      const firstId = firstAvailableWelcomeStepId();
      if (!firstId) {
        if (attempts < 20) window.setTimeout(tryStart, 150);
        return;
      }
      startedWelcomeRef.current = true;
      window.dispatchEvent(new CustomEvent('nitrogen:tour-expand-sidebar'));
      startWelcome(firstId);
    };

    const timer = window.setTimeout(tryStart, 450);
    const unsub = subscribeTourAnchors(() => {
      if (!useTourStore.getState().welcomeActive && !cancelled) {
        tryStart();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsub();
    };
  }, [pathname, replayNonce, router, startWelcome, welcomeCompleted]);

  // First-visit feature tips — only after welcome is done.
  // Mount-triggered tips fire when a floor panel header registers (mini stack "View all"
  // does not put ?panel= in the URL). Route-triggered tips still use pathname/search.
  useEffect(() => {
    if (welcomeActive || !welcomeCompleted) return;
    if (activeGroup) return;

    let cancelled = false;
    let timer: number | null = null;

    const tryStart = () => {
      if (cancelled || useTourStore.getState().activeGroup) return;
      const completed = useTourStore.getState().completedStepIds;

      // 1) Expanded floors (Overview / Variables / Assessments / Files) — tip when the
      //    floor header mounts. Mini-stack "View all" expands without ?panel=; require
      //    surface=floor so sidebar nav wrappers with the same id do not fire early.
      for (const step of MOUNT_TRIGGERED_FEATURE_STEPS) {
        if (completed.includes(step.id)) continue;
        if (promptedFeatureGroupsRef.current.has(step.group)) continue;
        if (!isFloorTourAnchor(step.id)) continue;
        promptedFeatureGroupsRef.current.add(step.group);
        startFeatureGroup(step.group, step.id);
        return;
      }

      // 2) Route-gated surfaces (if any remain).
      const group = featureGroupForRoute(pathname, search);
      if (!group) return;
      if (promptedFeatureGroupsRef.current.has(group)) return;
      const steps = getStepsForGroup(group);
      const pending = steps.filter(
        (s) => !completed.includes(s.id) && isTourAnchorRegistered(s.id),
      );
      if (pending.length === 0) return;
      promptedFeatureGroupsRef.current.add(group);
      startFeatureGroup(group, pending[0].id);
    };

    timer = window.setTimeout(tryStart, 250);
    const unsub = subscribeTourAnchors(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(tryStart, 80);
    });

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      unsub();
    };
  }, [
    activeGroup,
    completedStepIds,
    pathname,
    search,
    startFeatureGroup,
    welcomeActive,
    welcomeCompleted,
  ]);

  return (
    <>
      {children}
      <TourOverlay />
    </>
  );
}

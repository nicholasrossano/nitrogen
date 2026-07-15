export type TourGroup =
  | 'welcome'
  | 'feature-framework'
  | 'feature-assessments'
  | 'feature-variables'
  | 'feature-files'
  | 'feature-overview';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

export interface TourStep {
  id: string;
  group: TourGroup;
  title: string;
  body: string;
  placement?: TourPlacement;
  /**
   * How this tip is auto-started after welcome:
   * - `route`: when pathname/search match `routeMatch` (sidebar anchors stay mounted)
   * - `mount`: when the TourAnchor mounts (expanded floor panels)
   */
  trigger?: 'route' | 'mount';
  /** Used when trigger is `route` (or omitted and routeMatch is set). */
  routeMatch?: (pathname: string, search: string) => boolean;
}

function searchParamsOf(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

function projectView(pathname: string, search: string): string | null {
  if (!pathname.startsWith('/projects/')) return null;
  return searchParamsOf(search).get('view');
}

export const TOUR_STEPS: TourStep[] = [
  // --- Welcome (/chat chrome) ---
  {
    id: 'welcome-workspace',
    group: 'welcome',
    title: 'Your workspace',
    body: 'Switch workspaces here. A workspace holds your projects, team access, and shared materials.',
    placement: 'right',
  },
  {
    id: 'welcome-composer',
    group: 'welcome',
    title: 'Ask anything',
    body: 'This is your main chat. Ask about your project, explore options, or kick off an analysis from here.',
    placement: 'top',
  },
  {
    id: 'welcome-chats',
    group: 'welcome',
    title: 'Chats',
    body: 'Past conversations live here, organized by project. Start a new thread anytime from a project.',
    placement: 'right',
  },
  {
    id: 'welcome-recommended',
    group: 'welcome',
    title: 'Recommended assessments',
    body: 'Suggested analyses for this project appear here. Open one when you are ready to dig in.',
    placement: 'top',
  },
  {
    id: 'welcome-context-stack',
    group: 'welcome',
    title: 'Project context',
    body: 'Overview, Variables, and Files stay parked on the right so you can peek at them while you chat.',
    placement: 'left',
  },
  {
    id: 'welcome-files',
    group: 'welcome',
    title: 'Files',
    body: 'Upload and browse project materials here. The assistant can use what is available in Files.',
    placement: 'right',
  },
  {
    id: 'welcome-help',
    group: 'welcome',
    title: 'Help',
    body: 'Product docs are one click away if you want more detail beyond these tips.',
    placement: 'right',
  },

  // --- Feature discovery (first visit to each surface) ---
  {
    id: 'feature-overview',
    group: 'feature-overview',
    title: 'Status',
    body: 'Track initiative health and progress here. Open any row to dig into the underlying documents or assessments.',
    placement: 'bottom',
    trigger: 'mount',
  },
  {
    id: 'feature-framework',
    group: 'feature-framework',
    title: 'Framework',
    body: 'Structure your assessment plan here and decide which analyses you will run.',
    placement: 'right',
    trigger: 'route',
    routeMatch: (pathname, search) => {
      const view = projectView(pathname, search);
      return view === 'plan' || view === 'framework';
    },
  },
  {
    id: 'feature-assessments',
    group: 'feature-assessments',
    title: 'Assessments',
    body: 'Open finished and in-progress analyses for this project from the Assessments area.',
    placement: 'right',
    trigger: 'route',
    routeMatch: (pathname, search) => {
      const view = projectView(pathname, search);
      return view === 'workspace' || view === 'assessments';
    },
  },
  {
    id: 'feature-variables',
    group: 'feature-variables',
    title: 'Variables',
    body: 'Shared assumptions and inputs live here. They feed models and writeups across the project.',
    placement: 'bottom',
    trigger: 'mount',
  },
  {
    id: 'feature-files',
    group: 'feature-files',
    title: 'Files',
    body: 'Browse and manage uploads, Drive links, and source materials for this project.',
    placement: 'bottom',
    trigger: 'mount',
  },
];

export const WELCOME_STEP_IDS = TOUR_STEPS.filter((s) => s.group === 'welcome').map((s) => s.id);

export const MOUNT_TRIGGERED_FEATURE_STEPS = TOUR_STEPS.filter(
  (s) => s.group !== 'welcome' && s.trigger === 'mount',
);

export function getTourStep(id: string): TourStep | undefined {
  return TOUR_STEPS.find((s) => s.id === id);
}

export function getStepsForGroup(group: TourGroup): TourStep[] {
  return TOUR_STEPS.filter((s) => s.group === group);
}

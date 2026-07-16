/** Overlay floors promoted from the mini stack. Chat is the default floor when this is null. */
export type ChatContextExpandedWidget = 'overview' | 'variables' | 'files' | 'assessments';

export type ContextPanelExpandMotion = 'stack' | 'center';

export type ExpandedWidgetChangeOptions = {
  motion?: ContextPanelExpandMotion;
};

export const CONTEXT_PANEL_SEARCH_PARAM = 'panel';

export function parseContextPanelParam(value: string | null): ChatContextExpandedWidget | null {
  if (value === 'overview' || value === 'variables' || value === 'files' || value === 'assessments') {
    return value;
  }
  // Pre-rename alias
  if (value === 'framework' || value === 'plan') return 'assessments';
  return null;
}

/** Canonical project workbench URL — chat is default floor when panel/chat omitted. */
export function buildProjectWorkbenchPath(
  projectId: string,
  options?: {
    chat?: string | null;
    panel?: ChatContextExpandedWidget | null;
  },
): string {
  const params = new URLSearchParams();
  if (options?.chat) params.set('chat', options.chat);
  if (options?.panel) params.set(CONTEXT_PANEL_SEARCH_PARAM, options.panel);
  const query = params.toString();
  return query ? `/projects/${projectId}?${query}` : `/projects/${projectId}`;
}

export const CONTEXT_STACK_MOTION_MS = 300;

export const contextStackTransitionClass =
  'transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]';

export const contextStackPanelTransitionClass =
  'transition-[transform,opacity,border-color,box-shadow,right] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[transform,opacity]';

/**
 * Chrome (border/shadow) for an expandable panel. When `flushOnExpand` is set, the
 * floating-card chrome fades out as the panel becomes visible, so it settles as a flush
 * "floor" surface instead of staying a floating card (used for widgets that become the
 * primary work surface, e.g. Variables).
 */
export function contextStackExpandedPanelChromeClass(
  visible: boolean,
  flushOnExpand: boolean = false,
): string {
  if (flushOnExpand && visible) return 'border-transparent shadow-none';
  return 'border-stroke-subtle shadow-floating-panel';
}

export function contextStackExpandOriginClass(
  widget: ChatContextExpandedWidget,
  motion: ContextPanelExpandMotion = 'stack',
): string {
  if (motion === 'center') return 'origin-center';
  switch (widget) {
    case 'overview':
      return 'origin-top-right';
    case 'files':
      return 'origin-bottom-right';
    case 'variables':
      return 'origin-[right_38%]';
    case 'assessments':
      return 'origin-[right_30%]';
    default:
      return 'origin-top-right';
  }
}

export function contextStackWidgetMotionClass(
  expandedId: string | null,
  widgetId: string,
  renderedWidget: string | null = null,
): string {
  // Opacity/scale only — keep flex slot size stable so siblings don't reflow mid-animation.
  if (renderedWidget === widgetId || (expandedId !== null && expandedId !== widgetId)) {
    return 'pointer-events-none opacity-0 scale-95';
  }
  return 'pointer-events-auto opacity-100 scale-100';
}

export function contextStackBackdropMotionClass(
  expanded: boolean,
  motion: ContextPanelExpandMotion = 'stack',
): string {
  if (!expanded) return 'opacity-100 scale-100';
  if (motion === 'center') return 'opacity-45';
  return 'opacity-45 scale-[0.985]';
}

export function contextStackExpandedPanelMotionClass(
  visible: boolean,
  motion: ContextPanelExpandMotion = 'stack',
): string {
  if (motion === 'center') {
    return visible
      ? 'scale-100 opacity-100'
      : 'scale-95 opacity-0 pointer-events-none';
  }
  return visible
    ? 'scale-100 opacity-100'
    : 'scale-[0.22] opacity-0 pointer-events-none';
}

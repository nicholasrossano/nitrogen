export type ChatContextExpandedWidget = 'overview' | 'variables' | 'files';

export type ContextPanelExpandMotion = 'stack' | 'center';

export type ExpandedWidgetChangeOptions = {
  motion?: ContextPanelExpandMotion;
};

export const CONTEXT_PANEL_SEARCH_PARAM = 'panel';

export function parseContextPanelParam(value: string | null): ChatContextExpandedWidget | null {
  if (value === 'overview' || value === 'variables' || value === 'files') return value;
  return null;
}

export const CONTEXT_STACK_MOTION_MS = 300;

export const contextStackTransitionClass =
  'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]';

export const contextStackPanelTransitionClass =
  'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[transform,opacity]';

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
    default:
      return 'origin-top-right';
  }
}

export function contextStackWidgetMotionClass(
  expandedId: string | null,
  widgetId: string,
  renderedWidget: string | null = null,
): string {
  if (renderedWidget === widgetId) {
    return 'pointer-events-none max-h-0 flex-[0] overflow-hidden opacity-0 scale-95';
  }
  if (expandedId !== null && expandedId !== widgetId) {
    return 'pointer-events-none max-h-0 flex-[0] overflow-hidden opacity-0 scale-95 -translate-y-1';
  }
  return 'pointer-events-auto max-h-none flex-[1] opacity-100 scale-100 translate-y-0';
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

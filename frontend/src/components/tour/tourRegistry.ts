type Listener = () => void;

const anchors = new Map<string, Set<Element>>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function registerTourAnchor(id: string, element: Element) {
  let set = anchors.get(id);
  if (!set) {
    set = new Set();
    anchors.set(id, set);
  }
  set.add(element);
  notify();
}

export function unregisterTourAnchor(id: string, element: Element) {
  const set = anchors.get(id);
  if (!set) return;
  set.delete(element);
  if (set.size === 0) anchors.delete(id);
  notify();
}

/** Prefer a floor-surface anchor when present; otherwise the last registered element. */
export function getTourAnchorElement(id: string): Element | null {
  const set = anchors.get(id);
  if (!set || set.size === 0) return null;
  let last: Element | null = null;
  let floor: Element | null = null;
  for (const el of set) {
    last = el;
    if (el instanceof HTMLElement && el.dataset.tourSurface === 'floor') {
      floor = el;
    }
  }
  return floor ?? last;
}

export function isTourAnchorRegistered(id: string): boolean {
  return Boolean(getTourAnchorElement(id));
}

export function getTourAnchorRect(id: string): DOMRect | null {
  const el = getTourAnchorElement(id);
  if (!el || !(el instanceof HTMLElement)) return null;
  if (!el.isConnected) return null;
  // Skip targets hidden by collapse/overlay chrome (still in the DOM with a box).
  if (el.closest('.invisible, [aria-hidden="true"]')) return null;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

export function subscribeTourAnchors(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listRegisteredTourAnchorIds(): string[] {
  return Array.from(anchors.keys()).filter((id) => isTourAnchorRegistered(id));
}

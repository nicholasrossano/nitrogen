# Nitrogen UI Style Guide Examples

Use this doc for implementation patterns and edge cases that do not need to be loaded for every UI change.

## Modal Shell Pattern

- Use `ModalShell` for all feature/config dialogs.
- Keep header compact (title + close), place explanatory copy in body.
- Use frosted backdrop + modal shadow tokens for depth.

```tsx
<ModalShell onClose={onClose} maxWidth="max-w-2xl" className="flex flex-col max-h-[80vh]">
  <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle">
    <h2 className="text-sm font-semibold text-text-primary">Title</h2>
    <button onClick={onClose} className="p-1 rounded-lg text-text-tertiary hover:bg-surface-subtle">
      <X className="w-4 h-4" />
    </button>
  </div>
  <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">{/* body */}</div>
</ModalShell>
```

## Dropdown and Popover Layering

- Trigger wrapper: `relative`.
- Menu: `absolute ... z-50` (or higher if local stacking context requires).
- Do not keep menus inside clipping ancestors (`overflow-hidden`/`overflow-auto`).
- If needed, portal menus to a non-clipping ancestor.

## Tooltip Pattern

- Use shared `Tooltip` component; avoid hand-rolled hover bubbles.
- Prefer tooltip wrapping for disabled controls that need explanation.

## Panel Slide Pattern

- Animate panel width (`transition-[width] duration-300 ease-in-out`) and clip with `overflow-hidden`.
- Disable transition while resize drag is active.

```tsx
<div
  className="flex-shrink-0 overflow-hidden"
  style={{
    width: open ? `${widthPercent}%` : 0,
    transition: isResizing ? 'none' : 'width 300ms ease-in-out',
  }}
>
  <PanelContent />
</div>
```

## Resizable Split Chat Panel

- Persist open state in `localStorage`.
- Clamp drag width range (for example `20%` to `40%`).
- Hide split chat for viewer-only modes.
- Show panel toggle only when split view is relevant.

## Widget and Workflow Footer Action Bar

- Footer is horizontal: hint text left, compact primary action right.
- Use compact button tier (`btn-primary !text-xs !px-4 !py-1.5`).
- Avoid full-width CTA in widget/card footer rows.

```tsx
<div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
  <p className="text-[10px] text-text-tertiary">Hint text</p>
  <button className="btn-primary !text-xs !px-4 !py-1.5">Confirm</button>
</div>
```

## Hover-Reveal Action Button

- Keep indicator visible at rest and reveal action on row hover.
- Use named groups (`group/row`) for nested hover scopes.
- Use `e.stopPropagation()` for row-contained action triggers.

## FLIP Layout Transition (Geometry Reposition)

Use FLIP when items move because layout structure changes (column count, reorder, panel open/close):

1. Capture "first" geometry before state update.
2. Let React render final layout.
3. In `useLayoutEffect`, invert to previous position.
4. Play transition to settle into final position.

- Keep transition around `320ms` with `cubic-bezier(0.4, 0, 0.2, 1)`.
- Use for layout repositioning, not simple hover/press states.

## Chat-Attached Widget Panels

- Reuse shared chat widget shell for header/collapse/close/layout.
- Widget content should provide body content only; avoid reimplementing container chrome.
- Collapse attached widget panel when user sends a message to re-focus conversation.

## Loading Patterns

- Page-level wait: shared page loader.
- Inline wait: spinner (`Loader2`).
- Do not use page-level loader for button or row-level work.

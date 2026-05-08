# Nitrogen UI Style Guide (Core)

Use this file for fast, high-frequency UI decisions. Load deeper guidance only when needed from `docs/style-guide-examples.md`.

## 1) Design Principles

- Desktop workbench aesthetic, not browser-admin styling.
- Keep shell/chrome visually distinct from inset workspace content.
- Typography-led hierarchy, restrained geometry, subtle motion.
- Use depth via shadow and tonal contrast, not heavy borders.
- Accent color communicates interaction/affordance, not decoration.

### Do

- Keep layouts predictable, aligned, and neutral by default.
- Use accent color only for actionable/focus/selected states.
- Favor subtle motion for hover/press confirmation.

### Do Not

- Use blue borders/dividers for structural layout.
- Add playful motion, decorative shapes, or expressive fills.
- Mix visual metaphors in the same surface.

## 2) Core Color Tokens

| Group | Token | Hex | Primary use |
|---|---|---|---|
| Shell | `ShellBackground` | `#F8F7F6` | Outer app background |
| Shell | `ShellBar` | `#FAFAF9` | Top/nav shell surfaces |
| Surface | `SurfacePrimary` | `#FFFFFF` | Main workspace/cards |
| Surface | `SurfaceSubtle` | `#F4F3F2` | Secondary surfaces |
| Text | `TextPrimary` | `#1C1C1E` | Primary text |
| Text | `TextSecondary` | `#5A5A60` | Secondary text |
| Text | `TextTertiary` | `#8A8A90` | Helper text |
| Accent | `AccentPrimary` | `#005e72` | Focus/selected/active affordance |
| Accent | `AccentTint` | `#40bcd4` | Accent hover fills |
| Accent | `AccentWash` | `#e6f9fc` | Selected highlights |
| Divider | `Divider` | `#E5E3E1` | Structural separators |
| Stroke | `StrokeSubtle` | `#DAD8D6` | Input/subtle borders |

### Color Rules

- Default UI should read neutral.
- `AccentPrimary` is interactive, never structural.
- Structural separators use neutral `Divider`, never accent blue.
- Semantic indicator colors encode meaning only.

## 3) Typography

- Default font: Inter.
- Urbanist is limited to select display headers.
- Avoid italics in dense UI.
- Keep type hierarchy consistent by surface (screen title, section title, body, caption).

### Label Overflow Rule (Critical)

- Node/card labels must not reflow during layout transitions.
- Use `whitespace-nowrap` for primary labels and single-line metadata.
- Do not truncate primary labels unless there is no viable layout alternative.
- Prefer slight size reduction over clipping for truly long labels.

## 4) Spacing and Layout

- Base spacing scale: `8, 12, 16, 20, 24, 32`.
- Typical horizontal padding: `16-24`.
- Card padding: `16-20`.
- Dense stacks: `8-12`.

### Multi-Column Layout Rule

- For columns with independently growing content, use independent flex columns instead of CSS grid rows.
- Compute column count from container width (and panel-open state when needed).
- Avoid `min-w-0` on columns where label clipping would occur.

## 5) Shell and Workspace Model

- Shell: neutral outer chrome framing the app.
- Workspace: inset white content area with subtle elevation.
- Keep top bar/nav visually shell-native.
- Main work content should live inside the inset workspace container.

## 6) Shape and Radius

- Most dense/data surfaces stay sharp or lightly rounded.
- Standard container/card radius: `rounded-lg` (6px).
- Button/search/chat composers use approved pill/soft tiers.
- Never exceed 26px radius in application UI.
- Keep radius tier consistent within a peer action row.

## 7) Elevation and Borders

- Prefer shadow + tonal separation for containers/cards.
- Avoid visible container borders when shadow tokens are sufficient.
- Borders remain valid for inputs, inline separators, and legibility boundaries.

## 8) Navigation Rail

- Nav rail is shell-native: no white background block, no right border.
- Active state uses dark text + left indicator bar (not blue fill).
- Hover/active overlays are subtle and neutral.

## 9) Buttons and Actions

- Use shared global button classes from `globals.css`; do not hand-roll replacements.
- Primary/secondary pairs should share shape and sizing tier.
- Compact embedded action rows should use compact overrides consistently.
- Footer CTA patterns in widgets/cards should be right-aligned and compact, not full-width.

## 10) Motion and Feedback

- Hover/focus: `150-200ms`; press: `80-120ms`.
- Easing: `ease-out` or `ease-in-out`; no bounce/spring.
- Prefer opacity-fade hover transitions over abrupt color swaps.
- Press compression (`scale(0.98)`) for primary interactive elements.

## 11) Layering and Overlays

- Dropdowns/popovers/tooltips must not be clipped by parent overflow.
- Use shared tooltip/modal/shell primitives for consistent behavior.
- Render menus in a non-clipping ancestor (or portal) when needed.

## 12) Chat Surface Rules

- Chat composer uses approved radius/border/focus treatment.
- Send button is icon-led, no decorative background.
- User messages may use bubble treatment; assistant prose stays clean and readable.
- Reuse shared chat widget shell for attached panels.

## 13) Loading States

- Use shared page-level loader for route/panel/stage waits.
- Use inline spinner for button/sub-component loading.

## 14) Accessibility

- Maintain WCAG AA contrast.
- Never rely on color as sole state indicator.
- Keep focus/selection states clearly visible.

## 15) Source of Truth and Deep Dives

This core guide is the fast decision layer and remains the source of truth for defaults. Use `docs/style-guide-examples.md` only when implementing or revisiting complex patterns:

- modal/header shells
- dropdown/popover layering
- panel slide and split layouts
- hover-reveal actions
- FLIP layout transitions
- workflow/widget footer action bars

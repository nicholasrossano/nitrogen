# Nitrogen UI Style Guide  
**Desktop Workbench Visual System**

This guide defines the visual language for Nitrogen as a desktop-productivity platform.  
It is prescriptive and concise, prioritising clarity, restraint, and long-term credibility.

---

## A) Design Principles

- **Desktop workbench aesthetic** — feels like a native productivity tool, not a browser-first admin dashboard
- **Outer shell + inset workspace** — the app has a chrome layer (shell) distinct from the working surface
- **Typography-led hierarchy**
- **Restrained geometry** — sharp containers, soft depth, no decorative shapes
- **Depth through shadow, not stroke** — surfaces are separated by shadow and tonal contrast, not hard outlines
- **Color used primarily as meaning** — blue accent is for interactive affordance only, not decoration
- **Interaction feedback through subtle motion (web-equivalent haptics)**

**Do**
- Keep layouts predictable and grid-aligned  
- Use neutral shell surfaces by default  
- Separate the outer chrome from the workspace content visually  
- Apply blue accent deliberately — only where interaction is implied  
- Use micro-interactions to confirm intent  
- Prefer shadow/tonal contrast over visible borders for surface separation

**Don't**
- Use blue borders or dividers as structural decoration  
- Make the workspace feel "dropped directly onto a blank page" — it should feel inset  
- Use large expressive color fills  
- Introduce playful shapes or motion  
- Mix multiple visual metaphors  
- Allow interactions to feel inert or abrupt  

---

## B) Color System (Hex Tokens)

### Shell & App Chrome
These colors form the outer application frame — the background behind the workspace, the top bar, and the nav rail.

| Token | Hex | Usage |
| --- | --- | --- |
| `ShellBackground` | `#F8F7F6` | App outer background, page body |
| `ShellBar` | `#FAFAF9` | Top bar and nav rail fill |
| `ShellSubtle` | `#EFEEEC` | Shell-level hover, secondary grouping |

### Content Surfaces
| Token | Hex | Usage |
| --- | --- | --- |
| `SurfacePrimary` | `#FFFFFF` | Main workspace container, cards, panels |
| `SurfaceSubtle` | `#F4F3F2` | Forms, secondary panels, table rows |

### Text
| Token | Hex | Usage |
| --- | --- | --- |
| `TextPrimary` | `#1C1C1E` | Primary text |
| `TextSecondary` | `#5A5A60` | Metadata, secondary labels |
| `TextTertiary` | `#8A8A90` | Helper text, placeholders |

### Primary Accent (use sparingly — interactive elements only)
Blue is an affordance signal, not a structural or decorative color.

| Token | Hex | Usage |
| --- | --- | --- |
| `AccentAnchor` | `#00758c` | Strong pressed / active state |
| `AccentPrimary` | `#005e72` | Focus rings, enabled-state send button, selected state |
| `AccentTint` | `#40bcd4` | Hover fills on accent-tinted surfaces |
| `AccentWash` | `#e6f9fc` | Subtle accent highlight, selected row tint |

### Secondary Accent
| Token | Hex | Usage |
| --- | --- | --- |
| `AccentSecondaryAnchor` | `#2d3a4a` | Strong secondary emphasis |
| `AccentSecondary` | `#3d5068` | Secondary highlights |
| `AccentSecondaryTint` | `#7a90a8` | Secondary hover fills |
| `AccentSecondaryWash` | `#e4e8ed` | Secondary subtle highlight |

### Semantic Indicators
| Token | Hex | Usage |
| --- | --- | --- |
| `IndicatorOrange` | `#B97A5D` | Warning |
| `IndicatorYellow` | `#C6B875` | Pending |
| `IndicatorGreen` | `#9DAA9B` | Success |

### Strokes & Dividers
| Token | Hex | Usage |
| --- | --- | --- |
| `Divider` | `#E5E3E1` | Structural separators (warm grey) |
| `StrokeSubtle` | `#DAD8D6` | Input borders, subtle separators |
| `StrokeAccent` | `#005e72` | Focus / selected border (interactive only) |

**Rules**
- Default UI reads neutral — soft warm-greys and clean whites
- `AccentPrimary` is not a background or decorative color — it appears only where a user can click, focus, or select
- Dividers use warm neutrals (`Divider`), never blue
- Indicator colors encode meaning only — do not reuse for decoration

---

## C) Typography

### Fonts
- **Inter** — primary UI font
- **Urbanist** — limited display/header use

### Type scale
- **Screen Title**: 32, Inter Semibold  
- **Section Header**: 20–24, Urbanist Semibold  
- **Headline**: 18–20, Inter Semibold  
- **Body**: 16, Inter  
- **Body Small**: 14–15, Inter  
- **Caption**: 13–14, Inter  
- **Footnote**: 11–12, Inter Medium  

**Rules**
- Inter by default everywhere  
- Urbanist only for select headers  
- Avoid italics in dense UI  

### Label Overflow in Constrained Nodes

Card or node labels (primary title + metadata subtitle) must never reflow to multiple lines in response to a layout transition or panel open/close. Reflow during animation is the main source of perceived visual chaos.

**Rules**
- Apply `whitespace-nowrap` to both the primary label and any single-line metadata subtitle — this prevents mid-transition text reflow entirely
- **Never use `truncate` (`overflow-hidden whitespace-nowrap text-ellipsis`) on a primary label** — clipping the name removes information the user needs
- The column/container's minimum width should be set by content (`min-width: auto`, the flex default), not forced smaller with `min-w-0`, so the title always has room to display fully
- If a label is genuinely too long for any reasonable column width, the fallback is **smaller text (`text-xs` or `clamp()`)**, not truncation

```tsx
{/* ✅ correct — title can never wrap, column width adapts to fit it */}
<div className="flex-1">
  <h3 className="text-sm font-semibold whitespace-nowrap">{title}</h3>
  <p className="text-xs text-text-tertiary whitespace-nowrap">{subtitle}</p>
</div>

{/* ❌ wrong — overflow-hidden + truncate clips the primary label */}
<div className="flex-1 min-w-0 overflow-hidden">
  <h3 className="text-sm font-semibold truncate">{title}</h3>
</div>
```

---

## D) Spacing & Layout

### Spacing scale
`8, 12, 16, 20, 24, 32`

### Conventions
- Horizontal padding: **16–24**  
- Section spacing: **16–24**  
- Card padding: **16–20**  
- Dense stacks: **8–12**

---

## D2) Pillar / Node Reuse Pattern

When building category/entity tree UIs (assessment workspaces, plan structures, similar node stacks), reuse the shared pillar/node primitives instead of rebuilding visual clones.

### Shared primitives
- Pillar headers and node rows should come from shared components (`PlanStructureColumn`, `PlanItemNode`) or extracted sub-primitives.
- Variant behavior must be prop-driven (editor mode vs diagram mode), not copy-pasted component forks.

### Mode rules
- **Diagram mode**: no right-side editing chrome (drag handles / delete buttons).
- **Editor mode**: right-side drag and delete controls are allowed and should be explicit.
- Keep branch-line geometry and node card proportions identical across modes.

### Draft add-node pattern
- Add flow starts from a centered green add-dot button under the stack (same affordance as other node add patterns).
- The in-progress add row should render as a **neutral draft node** (`border-divider` / subtle grey fill), not as a confirmed colored node.
- Draft composer captures only the primary label/title by default unless the surface explicitly requires additional fields.

### Rhythm & alignment
- Maintain the same vertical gap cadence between active nodes and draft rows (no compressed draft spacing).
- If subtitle metadata is absent, primary node labels remain vertically centered within the row.

---

### Multi-Column Layouts with Independent Column Heights

When displaying a set of cards or nodes across multiple columns, prefer **independent flex columns** over CSS Grid.

**The problem with CSS Grid:** grid rows couple all cells in the same row together — when one cell expands (e.g. an accordion opens), every other cell in that row grows to match, leaving empty space next to unrelated items.

**The solution:** render N independent `flex-col` containers and distribute items using row-major order (`index % numCols`). Each column manages its own height independently.

```tsx
<div className="flex gap-6 items-start">
  {Array.from({ length: numCols }, (_, colIdx) => (
    <div key={colIdx} className="flex-1 flex flex-col gap-6">
      {items
        .filter((_, i) => i % numCols === colIdx)
        .map(item => <Card key={item.id} item={item} />)}
    </div>
  ))}
</div>
```

**Column count:** compute `numCols` from a `ResizeObserver` on the outer container so the layout responds to both window resize and sibling panel open/close. Do **not** use CSS container queries when you need column count in JS (they don't communicate back).

```tsx
const outerRef = useRef<HTMLDivElement>(null);
const containerWidth = useRef(0);
const [numCols, setNumCols] = useState(3);
const panelOpenRef = useRef(false);
const PANEL_WIDTH = 420;
const computeCols = (w: number) => (w >= 832 ? 3 : w >= 512 ? 2 : 1);

useEffect(() => {
  const observer = new ResizeObserver(([entry]) => {
    const w = entry.contentRect.width;
    containerWidth.current = w;
    setNumCols(computeCols(w - (panelOpenRef.current ? PANEL_WIDTH : 0)));
  });
  observer.observe(outerRef.current!);
  return () => observer.disconnect();
}, []);
```

**Panel-awareness:** when a side panel opens or closes, switch `numCols` **immediately** (before the panel animation starts) so cards jump to their final column width first and the panel slides in alongside them. This avoids the "shrink-shrink-snap" artefact.

```tsx
// Runs after panelOpen is declared (avoid temporal dead zone)
useEffect(() => {
  panelOpenRef.current = panelOpen;
  const gridW = containerWidth.current - (panelOpen ? PANEL_WIDTH : 0);
  if (gridW > 0) setNumCols(computeCols(gridW));
}, [panelOpen]);
```

**Column minimum width:** do **not** add `min-w-0` to column flex items — the default `min-width: auto` lets content size set the floor. Each column will be at least as wide as its widest card, so labels never need to be clipped to fit.

---

## E) Shell + Workspace Layout Model

The application is structured as two distinct visual layers:

### Layer 1: Shell (outer chrome)
- Background: `ShellBackground` (`#F5F6F8`)
- Contains: top bar, nav rail, outer padding
- The shell is always visible at the page edges — it frames the workspace
- Top bar and nav rail are **transparent on the shell** — they share the shell background, not a separate white surface
- Shell padding around the workspace: `p-2 pl-1` (8px all sides, 4px on the left where the nav rail sits)

### Layer 2: Workspace (inset content area)
- Background: `SurfacePrimary` (`#FFFFFF`)
- Applied as: `bg-surface rounded-lg shadow-workspace`
- The workspace container is visually distinct from the shell — white, rounded, slightly elevated
- `shadow-workspace`: `0 1px 4px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.03)`
- All main content (chat, plan view, project grid) lives inside this container

```tsx
{/* Shell */}
<div className="h-screen flex flex-col bg-background">
  <header className="shrink-0 px-4 py-[7px] flex items-center">
    {/* top bar — no bg class, inherits shell */}
  </header>
  <div className="divider-accent shrink-0" />
  <div className="flex flex-1 min-h-0">
    <SideDrawer /> {/* no bg class, inherits shell */}
    {/* Workspace inset */}
    <div className="flex-1 p-2 pl-1 min-h-0">
      <main className="h-full bg-surface rounded-lg shadow-workspace overflow-hidden">
        {/* page content */}
      </main>
    </div>
  </div>
</div>
```

---

## F) Shape & Corner Radius

### Default: Sharp Edges
Most data surfaces and workspace elements use no border radius (0px) for a precise, architectural feel:
- Data tables & list items
- Navigation rows
- Badges & status indicators

### Exceptions by Context

| Element | Radius | Token |
| --- | --- | --- |
| **Workspace container** | `8px` | `rounded-lg` |
| **Cards & panels** | `8px` | `rounded-lg` |
| Icon-only action buttons (edit, delete, close) | 4–6px | `rounded-sm` / `rounded` |
| Interactive pill tags (selection, toggle) | 4–6px | `rounded` |
| Ghost row hovers (history items, nav rows) | 8–12px | `rounded-lg` / `rounded-xl` |
| Primary / secondary buttons (`btn-primary`, `btn-secondary`) | 20px | `rounded-[20px]` |
| Module workspace header actions (beside stage stepper: Decision log, Approve, Export) | 6px | `!rounded-md` — intentional override so they sit in the same visual tier as the stage toggle group |
| Search inputs | 20px | `rounded-[20px]` |
| Chat composer textarea | 28px | `rounded-[28px]` |
| Message bubbles (user) | 16px | `rounded-2xl` |

**Rules**
- Workspace container and cards use `rounded-lg` (8px) — this is a key change from the prior sharp-edge default for containers
- Chat and messaging surfaces use pill-style rounding (20–28px) — approved exception
- Never exceed **28px** anywhere in the UI
- Consistent application within a surface: all inputs on the same page should share a radius tier

---

## G) Elevation & Depth

Surfaces are separated through **shadow and tonal contrast**, not visible borders or strokes. The goal is a layered, dimensional feel without heaviness.

### Shadow tokens

| Token | Value | Usage |
| --- | --- | --- |
| `shadow-workspace` | `0 1px 4px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.03)` | Workspace container |
| `shadow-card` | `0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)` | Cards, panels at rest |
| `shadow-card-hover` | `0 8px 24px -6px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)` | Interactive card hover |
| `shadow-subtle` | `0 1px 2px rgba(0,0,0,0.04)` | Minimal lift |
| `shadow-modal` | `0 16px 48px -8px rgba(0,0,0,0.16), 0 4px 12px -4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)` | Floating modals (no overlay) |

### Card treatment
Cards do **not** use visible borders. They use `shadow-card` — a subtle ring-style shadow that reads as a soft edge against the white surface. On hover, shadow lifts to `shadow-card-hover`.

```css
.card {
  @apply bg-surface rounded-lg shadow-card;
}

.card-interactive {
  @apply card cursor-pointer;
  transition: box-shadow 200ms ease-out, transform 200ms ease-out;
}

.card-interactive:hover {
  box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.04);
}
```

**Rules**
- Cards and panels use shadow separation, not `border` strokes
- The `border-1 border-stroke-subtle` pattern is deprecated for container-level elements
- Borders are still acceptable on form inputs, inline separators within panels, and functional elements where a clear boundary aids legibility

---

## H) Navigation Rail

The nav rail is a **quiet, shell-native** component. It sits on the shell background with no background or border of its own.

### Structure
- Container: no `bg-white`, no `border-r` — transparent on the shell
- Width: collapsed `w-12`, expanded `hover:w-44` via `transition-[width]`
- Labels fade in on group hover (`opacity-0 group-hover:opacity-100`)
- Top padding: `pt-1`

### Nav row states

| State | Treatment |
| --- | --- |
| Default | Transparent, `text-text-secondary` |
| Hover | White-frost overlay (`rgba(255,255,255,0.55)`), `text-text-primary` |
| Active | White-frost overlay (always on), `text-text-primary`, 2px left indicator bar |

The active indicator is a 2px vertical bar on the left edge (not a blue background or blue text):

```css
.nav-row-active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 2px;
  border-radius: 1px;
  background: var(--color-text-primary);
}
```

**Rules**
- No blue strokes, borders, or fills on nav rows — active state uses dark text + left indicator only
- The nav rail never has a visible right border separating it from the workspace
- Icon fill (solid) on active items is acceptable as an additional subtle signal

---

## I) Dividers & Separators

All structural dividers use warm neutral tones, not blue.

```css
.divider-accent {
  background: var(--color-divider); /* #E0DCD6 */
}
```

- The header-to-content divider line is warm grey, not blue
- `StrokeAccent` (`#004d91`) is reserved for interactive border states (focus rings, selected borders) only
- Never use `bg-accent` or `border-accent` for structural layout lines

---

## J) Icons & Imagery

### Icons
- **System**: Lucide React (monochromatic, 16–24px stroke)
- **Color**: Inherit from context or use accent colors
- **Usage**: Functional only — enhance meaning, don't decorate
- **No emojis**: Never use emoji in production UI

### Imagery
- Informational imagery only  
- Match image corners to container (8px standard)
- No decorative illustrations  

---

## K) Buttons

Three button classes are defined in `globals.css`. Always use these — never roll your own button styles.

### `btn-primary` — Primary action (accent fill on hover)
Use for the main confirming action in any panel or widget: Export, Confirm, Generate, Submit.

```tsx
<button className="btn-primary">Export to Word</button>

// Full-width (e.g. inside a panel footer):
<button className="btn-primary w-full !px-4 !py-2">Confirm & Begin Build</button>

// With icon:
<button className="btn-primary">
  <Download className="w-4 h-4" />
  Export to Word
</button>
```

**Appearance**: `border border-accent text-accent bg-surface`, pill-shaped (`rounded-[20px]`). Hover fills with accent color via `::before` opacity fade. Press compresses to `scale(0.98)`.

### `btn-secondary` — Secondary / cancel
Use for secondary actions: Cancel, Re-draft, Settings, less critical triggers.

```tsx
<button className="btn-secondary">Cancel</button>
```

**Appearance**: `border border-stroke-subtle text-text-primary bg-surface`.

### `btn-danger` — Destructive
Use only for irreversible destructive actions: Delete, Remove, Revoke.

```tsx
<button className="btn-danger">Delete project</button>
```

**Appearance**: red destructive treatment (`indicator-red`) with red border/text at rest and red fill on hover.

### Rules
- **Never** create custom button styles with raw Tailwind when one of the three classes fits.
- **Disabled hover**: always add `:disabled:hover::before { opacity: 0 }` suppression — already included in the global classes.
- Size overrides use Tailwind `!important` modifiers: `!px-4 !py-1.5` to make a smaller button, `!px-6 !py-3` for a larger one.
- `w-full` makes any button full-width inside its container.
- **Corner model by context**:
  - **Floating/standalone CTA** buttons keep the default capsule shape (`rounded-[20px]`).
  - **Embedded flow buttons** (inline with inputs, table rows, modal form actions — e.g. Share/Create buttons) should override to lightly rounded corners (`!rounded-lg` or `!rounded-md`).
  - In any given button row, peer buttons must use the same radius tier.

### Module workspace header (aligned with stage toggle)
Actions in the module workspace top bar that sit **next to the stage stepper** (Decision log, Approve, module Export, and the same pattern elsewhere) must match the **stage segment** typography, not the default global button size:

- Stage segments use `text-xs font-medium` and `gap-1.5` between icon and label (`ModuleWorkspace` stage stepper).
- `btn-primary` / `btn-secondary` default to `text-sm` and `gap-2` in `globals.css` — always override in this row with **`!text-xs !font-medium !gap-1.5`** so label text reads the same size and weight as the toggle.
- Keep the compact control tier with **`!py-1.5 !px-3 !rounded-md`** alongside the stepper (see **F) Shape** — module workspace header row in the radius table).

```tsx
<button
  type="button"
  className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
>
  …
</button>
<button
  type="button"
  className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
>
  …
</button>
```

---

## K2) Motion & Interaction Feedback (Web-Equivalent Haptics)

Motion replaces haptics on the web. Feedback should feel **immediate, weighted, and deliberate**, never playful.

### Timing & Easing
- **Hover / focus**: 150–200ms  
- **Press / active**: 80–120ms  
- **Easing**: `ease-out` or `ease-in-out`  
- No spring, bounce, or elastic easing  

### Opacity Fade Pattern (Preferred)
Use opacity fades instead of hard color swaps for hover and selection states.

```css
.element {
  position: relative;
  overflow: hidden;
}

.element::before {
  content: '';
  position: absolute;
  inset: 0;
  background-color: var(--target-color);
  opacity: 0;
  transition: opacity 200ms ease-in-out;
}

.element:hover::before {
  opacity: 1;
}
```

Use for:
- Buttons (primary, secondary, ghost)
- Selectable rows or list items
- Interactive cards
- Pills and toggle-style controls

### Press Compression

For primary interactive elements, use press compression on active. Buttons do **not** lift or add shadow on hover — hover is communicated through the opacity-fill only.

```css
.element {
  transition: transform 200ms ease-out;
}

.element:active {
  transform: scale(0.98);
  transition: transform 100ms ease-out;
}
```

**Rules**
- Hover: opacity-fill feedback only (no shadow, no lift)
- Press: compress (`scale(0.98)`) — active transition is faster than hover for snappier tactile feel
- Scale only 1–2%
- Never combine with bounce or elastic motion

**Apply to**
- Primary action buttons
- Secondary buttons
- Clickable cards (cards use shadow lift — see Card Hover below)

**Do not apply to**
- Inline links
- Icon-only buttons
- Ghost buttons
- Dense table rows

---

### Hover-Reveal Action Button (Fade + Scale Pop)

Use when a contextual action (delete, edit, copy, etc.) should stay hidden at rest and appear in place of — or overlaid on — a static indicator (dot, icon, badge) when the user hovers over a row or node.

**Behavior**
- **Rest**: static indicator visible; action button invisible and compressed (`scale-50 opacity-0`)
- **Hover**: indicator fades out; button expands and fades in (`scale-100 opacity-100`)
- **Leave**: both reverse simultaneously
- **Timing**: `duration-200 ease-out` — medium speed, snappy arrival

**Implementation (Tailwind)**

Use Tailwind named groups (`group/{name}`) so nested rows don't bleed hover state into each other.

```tsx
{/* Parent row — owns the hover scope */}
<div className="flex items-stretch relative group/row">

  {/* Static indicator wrapper */}
  <div className="relative w-2 h-2 flex-shrink-0">

    {/* Indicator — fades out on row hover */}
    <div className="w-2 h-2 rounded-full transition-opacity duration-200 ease-in-out
                    group-hover/row:opacity-0 bg-accent" />

    {/* Action button — pops in on row hover, centered over the indicator */}
    <button
      onClick={(e) => { e.stopPropagation(); onAction(); }}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                 w-4 h-4 rounded-full flex items-center justify-center
                 opacity-0 scale-50
                 group-hover/row:opacity-100 group-hover/row:scale-100
                 transition-all duration-200 ease-out z-20
                 bg-red-500 hover:bg-red-600"
      aria-label="Delete"
    >
      <Minus className="w-2.5 h-2.5 text-white" />
    </button>

  </div>

  {/* Rest of row content */}
</div>
```

**Sizing guide**

| Indicator size | Button size | Icon size |
| --- | --- | --- |
| `w-2 h-2` (8px dot) | `w-4 h-4` | `w-2.5 h-2.5` |
| `w-1.5 h-1.5` (6px dot) | `w-3.5 h-3.5` | `w-2 h-2` |
| `w-4 h-4` (icon) | `w-6 h-6` | `w-3.5 h-3.5` |

**Rules**
- Always use named groups (`group/{name}`) when multiple hover scopes exist in the same component
- Use `e.stopPropagation()` on the button click to avoid triggering the parent row's click handler
- Button background: `bg-red-500` for destructive actions; use accent tones for non-destructive actions
- The button size should be at least 2× the indicator size for a comfortable hit area
- Indicator transition uses `ease-in-out`; button appearance uses `ease-out` (snappier pop-in)
- Never add bounce or spring

**Apply to**
- Tree/graph node dots (project plan, requirement nodes)
- List row inline actions revealed on hover
- Any static indicator that doubles as a delete/action trigger

**Do not apply to**
- Primary action buttons (use Shadow Lift pattern instead)
- Buttons that are always visible
- Dense tables where hover state is already used for row highlighting

---

### Panel Slide (Width Collapse / Expand)

Use when a side panel — sidebar, chat panel, inspector — should open or close with a smooth horizontal slide rather than an abrupt show/hide.

**Behavior**
- **Open → Close**: panel width animates from its natural size to `0`, content clips via `overflow-hidden`
- **Close → Open**: reverses smoothly
- **Timing**: `300ms ease-in-out`
- **Border**: attach the panel's divider border to the outer wrapper so it disappears with the panel
- **Resize interactions**: disable transition (`transition: none`) while actively dragging a resize handle

**Implementation**

```tsx
{/* Fixed-width panel (e.g. sidebar, inspector) */}
<div className={`overflow-hidden transition-[width] duration-300 ease-in-out flex-shrink-0
                 ${open ? 'w-44' : 'w-0'}`}>
  <PanelContent />
</div>

{/* Dynamic / resizable panel */}
<div
  className="flex-shrink-0 overflow-hidden"
  style={{
    width: open ? `${widthPercent}%` : 0,
    transition: isResizing ? 'none' : 'width 300ms ease-in-out',
  }}
>
  <div className="absolute inset-0">
    <PanelContent />
  </div>
</div>
```

**Apply to**
- Navigation sidebar (home, chat pages)
- Inspector / deep-dive panel in project plan view

**Do not apply to**
- Modals or overlays (use opacity/scale instead)
- Inline content that reflows (use height animation or `display: none`)

---

### Modal Pattern (Settings-Style Header)

Use `ModalShell` (`@/components/ui/ModalShell`) as the default wrapper for all feature/configuration dialogs. It handles portal mounting, Escape key, and click-outside-to-close. Depth is conveyed by a frosted backdrop (`bg-black/40 backdrop-blur-sm`) combined with `shadow-modal`.

```tsx
import { ModalShell } from '@/components/ui/ModalShell';

<ModalShell onClose={onClose} maxWidth="max-w-2xl" className="flex flex-col max-h-[80vh]">
  {/* Header */}
  <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle flex-shrink-0">
    <h2 className="text-sm font-semibold text-text-primary">Modal Title</h2>
    <button
      onClick={onClose}
      className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
    >
      <X className="w-4 h-4" />
    </button>
  </div>

  {/* Scrollable body */}
  <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
    <p className="text-sm text-text-tertiary mb-6">
      Context and guidance live in the body, not the header.
    </p>
    {/* modal content */}
  </div>
</ModalShell>
```

**`ModalShell` props**

| Prop | Default | Description |
| --- | --- | --- |
| `onClose` | required | Called on Escape, click-outside, or close button |
| `maxWidth` | `'max-w-md'` | Tailwind max-width class for the panel |
| `className` | `''` | Extra classes on the panel (e.g. `flex flex-col max-h-[80vh]`) |

**Rules**
- Always use `ModalShell` — never hand-roll `fixed inset-0` modal wrappers
- Frosted backdrop (`bg-black/40 backdrop-blur-sm`) + `shadow-modal` provide depth and focus
- Header stays compact: title + close button only; put descriptive copy in the body
- Width by intent: `max-w-sm` for lightweight settings, `max-w-2xl`–`max-w-3xl` for content-rich pickers
- Add `flex flex-col max-h-[80vh]` via `className` when the body needs to scroll independently
- Body scrollable pattern: `flex-1 min-h-0 overflow-y-auto`

---

### Dropdown / Popover Layering

Menus must render above neighboring panels and never be clipped by parent containers.

**Rules**
- For any dropdown/popover trigger wrapper, use `className="relative"` and menu `className="absolute ... z-50"` (or higher when required by local stacking context).
- Never place dropdown menus inside ancestors with `overflow-hidden` (or `overflow-y-auto` clipping the axis you need); use `overflow-visible` on the nearest container that wraps the menu.
- If a menu can extend beyond a scroll container or modal section, render it in a non-clipping ancestor (or portal) rather than raising `z-index` alone.
- In shell/interstitial controls (workspace selectors, settings pickers), use the custom dropdown pattern (button + popover menu). Avoid native `<select>` for these surfaces.

---

### Tooltips

Use the shared tooltip component (`@/components/ui/Tooltip`) for explanatory hover text. It follows cursor position and renders in a portal, which avoids clipping and keeps behavior consistent across the app.

**Rules**
- Do not hand-roll custom absolute-position tooltip bubbles for new UI.
- For disabled controls that need explanation, wrap the trigger in `Tooltip` instead of using `title` or local hover bubbles.
- Prefer `fitContent` for short guidance copy and leave fixed width for longer explanatory text.

---

### Resizable Chat Side Panel (Split-View Pattern)

A horizontally resizable chat panel docked to the left of a main content area. The panel slides in/out via the Panel Slide pattern and can be dragged to any width within a clamped range using a drag handle on its right edge.

**Key implementation details**

- **Toggle state**: `showChatPanel` (boolean, persisted to `localStorage`) — remembers the user's last open/closed preference across sessions
- **Width state**: `chatWidthPercent` (number, initialized from `DEFAULT_CHAT_WIDTH_PERCENT`) — updated live during drag
- **Width constraints**: `MIN_CHAT_WIDTH_PERCENT = 20`, `MAX_CHAT_WIDTH_PERCENT = 40`, `DEFAULT = 30`
- **Resize handle**: a 1px-wide absolutely-positioned div on the right edge of the panel container. Uses `cursor-col-resize`. While dragging (`isResizing === true`) the CSS transition is disabled (`transition: none`) to avoid fighting with mouse tracking.
- **Toggle button**: a `PanelLeft` (Lucide) icon button in the `ProjectHeader` via the `leftToggle` prop. Active state uses `text-accent`; inactive uses `text-text-tertiary`.

**Layout structure**

```tsx
{/* Outer split container */}
<main ref={containerRef} className="h-full min-w-0 flex overflow-hidden relative">

  {/* Left: collapsible chat panel */}
  <div
    className="flex-shrink-0 relative overflow-hidden"
    style={{
      width: showChatPanel ? `${chatWidthPercent}%` : 0,
      transition: isResizing ? 'none' : 'width 300ms ease-in-out',
    }}
  >
    <div className="absolute inset-0">
      <ChatPanel ... />
    </div>

    {/* Drag handle — only rendered when panel is open */}
    {showChatPanel && (
      <div
        onMouseDown={handleResizeStart}
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize
                    hover:bg-accent/30 transition-colors
                    ${isResizing ? 'bg-accent/50' : 'bg-transparent'}`}
      />
    )}
  </div>

  {/* Right: main content fills remaining space */}
  <div className="flex-1 overflow-hidden">
    <MainContent />
  </div>

</main>
```

**Resize handlers**

```tsx
const MIN_CHAT_WIDTH_PERCENT = 20;
const MAX_CHAT_WIDTH_PERCENT = 40;
const DEFAULT_CHAT_WIDTH_PERCENT = 30;

const containerRef = useRef<HTMLDivElement>(null);
const [chatWidthPercent, setChatWidthPercent] = useState(DEFAULT_CHAT_WIDTH_PERCENT);
const [isResizing, setIsResizing] = useState(false);

const handleMouseMove = useCallback((e: MouseEvent) => {
  if (!isResizing || !containerRef.current) return;
  const rect = containerRef.current.getBoundingClientRect();
  const newWidthPercent = ((e.clientX - rect.left) / rect.width) * 100;
  setChatWidthPercent(Math.min(MAX_CHAT_WIDTH_PERCENT, Math.max(MIN_CHAT_WIDTH_PERCENT, newWidthPercent)));
}, [isResizing]);

const handleMouseUp = useCallback(() => setIsResizing(false), []);

useEffect(() => {
  if (isResizing) {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
}, [isResizing, handleMouseMove, handleMouseUp]);

const handleResizeStart = (e: React.MouseEvent) => {
  e.preventDefault();
  setIsResizing(true);
};
```

**Toggle handler (with localStorage persistence)**

```tsx
const [showChatPanel, setShowChatPanel] = useState(() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('nitrogen-plan-chat-panel-open') === 'true';
  }
  return false;
});

const handleToggleChatPanel = () => {
  setShowChatPanel(prev => {
    const next = !prev;
    localStorage.setItem('nitrogen-plan-chat-panel-open', String(next));
    return next;
  });
};
```

**Header toggle button wiring (via `ProjectHeader` `leftToggle` prop)**

```tsx
leftToggle: showPanelToggle ? {
  active: showChatPanel,
  onClick: handleToggleChatPanel,
  title: showChatPanel ? 'Hide chat panel' : 'Show chat panel',
} : undefined,
```

In `ProjectHeader.tsx`, `leftToggle` renders a `PanelLeft` icon button:

```tsx
{leftToggle && (
  <button
    onClick={leftToggle.disabled ? undefined : leftToggle.onClick}
    disabled={leftToggle.disabled}
    title={leftToggle.title}
    className={`icon-btn p-1.5 ${leftToggle.active ? 'text-accent' : 'text-text-tertiary'} ...`}
  >
    <PanelLeft className="w-4 h-4" />
  </button>
)}
```

**Rules**
- Persist open/closed state to `localStorage` so users don't have to re-open the panel on every navigation
- Disable the CSS `width` transition while `isResizing` to prevent the panel lagging behind the cursor
- Clamp drag width to `[MIN, MAX]` percent — never allow the panel to occupy more than 40% of the workspace
- Only show the toggle button in the header when the split-view is active (i.e. a plan/content panel exists alongside chat); hide it during full-width onboarding
- Never show the split chat panel to viewers (`isViewer`) — the chat surface is editor-only

**When to use**
- Any view where a persistent chat thread should be available alongside a primary content panel (plan view, document editor, etc.)
- The onboarding/setup phase should use a **full-width** `ChatPanel` instead (no split, no toggle button) — only switch to the split layout after the primary content (e.g. project plan) has been generated

---

### Layout Transition — FLIP (Geometry-Based Repositioning)

Use when items **physically move to new positions** in response to a layout change (e.g. column count switching, item reordering, panel open/close). FLIP makes cards appear to slide to their new positions rather than disappearing and reappearing.

**Why not View Transitions API?** The default view-transition crossfade between screenshots looks identical to disappear/reappear. FLIP operates on the live DOM element so the card visually slides.

**Timing:** `320ms cubic-bezier(0.4, 0, 0.2, 1)` (material ease-in-out).

**Four steps:**

| Step | When | What |
|---|---|---|
| **First** | Before state update | Snapshot each element's `getBoundingClientRect()` |
| **Last** | React re-renders | DOM moves elements to new positions |
| **Invert** | `useLayoutEffect` (before paint) | Apply CSS transform to put elements back at old position |
| **Play** | Same `useLayoutEffect` | Remove transform with transition — elements slide to new position |

```tsx
// In the parent component — register refs for each animated item
const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
const flipSnapshot = useRef<Map<string, { x: number; y: number }>>(new Map());

const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
  if (el) itemRefs.current.set(id, el);
  else itemRefs.current.delete(id);
}, []);

// INVERT + PLAY: fires before browser paints after layout change
useLayoutEffect(() => {
  const snapshot = flipSnapshot.current;
  if (snapshot.size === 0) return;

  itemRefs.current.forEach((el, id) => {
    const prev = snapshot.get(id);
    if (!prev) return;
    const curr = el.getBoundingClientRect();
    const dx = Math.round(prev.x - curr.x);
    const dy = Math.round(prev.y - curr.y);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.offsetHeight; // force reflow to commit the snap

    el.style.transition = 'transform 320ms cubic-bezier(0.4, 0, 0.2, 1)';
    el.style.transform = '';
    el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
  });

  flipSnapshot.current = new Map();
}, [layoutKey]); // depend on whatever triggers the layout change (numCols, order, etc.)

// FIRST: snapshot before triggering the layout change
const triggerLayoutChange = useCallback((next: unknown) => {
  flipSnapshot.current = new Map();
  itemRefs.current.forEach((el, id) => {
    const r = el.getBoundingClientRect();
    flipSnapshot.current.set(id, { x: r.x, y: r.y });
  });
  applyChange(next); // e.g. setNumCols(next)
}, []);
```

```tsx
// In the animated item — register its DOM node
<div ref={el => registerRef(item.id, el)} className="...">
```

**Rules**
- Snapshot **before** calling `setState` — after the render the old positions are gone
- `useLayoutEffect` fires before the browser paints, so the INVERT step is invisible to the user
- Items that move between different parent DOM nodes (e.g. between column divs) are handled correctly — React re-uses the keyed component but remounts the DOM node; the ref callback fires with the new element, which is already at its new position
- Only use for **layout-driven** position changes, not hover/press states (use transform + transition directly for those)

**Apply to**
- Card grids that reflow when a side panel opens/closes
- Reorderable lists
- Any item set that can change column count or position in response to a state change

---

### 3D Depth Effect (Marketing Pages Only)

For marketing/landing pages and promotional materials only. **Do not use in core application UI.**

```css
.btn-marketing {
  position: relative;
  transition: transform 150ms ease-out, box-shadow 150ms ease-out;
  box-shadow: none;
}

.btn-marketing:hover {
  transform: translate(-4px, -4px);
  box-shadow: 4px 4px 0 0 var(--shadow-color);
}

.btn-marketing:active {
  transform: translate(0, 0);
  box-shadow: none;
  transition: transform 50ms ease-out, box-shadow 50ms ease-out;
}
```

---

### Deliberate Micro-Delay

For high-importance actions, a 30–60ms delay before state change is acceptable to add perceived weight.

---

## L) Chat & Messaging Patterns

These are the approved patterns for all chat and compliance-chat surfaces. Follow them exactly.

### Chat Composer (Textarea Input)

```tsx
<textarea
  className="w-full resize-none rounded-[28px] border border-stroke-subtle bg-surface
             px-5 py-3.5 pr-12 text-sm text-text-primary
             placeholder:text-text-tertiary
             focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none
             disabled:bg-surface-subtle disabled:text-text-tertiary
             transition-colors duration-150 overflow-hidden"
  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
/>
```

**Rules**
- `rounded-[28px]` — pill shape is the approved chat input radius
- `border-stroke-subtle` default → `border-accent` + `ring-1 ring-accent/20` on focus
- `py-3.5` for the landing/full-page composer; `py-3` for the in-conversation composer
- Auto-resize capped at `150px`
- Hidden scrollbar via inline style (Tailwind cannot suppress it cross-browser)

### Send Button

```tsx
<button
  type="submit"
  disabled={disabled || !input.trim()}
  className="flex items-center justify-center
             text-text-tertiary enabled:text-accent
             transition-colors duration-150 disabled:cursor-default"
>
  <Send className="w-[18px] h-[18px]" />
</button>
```

**Rules**
- No background, no border — icon color carries the full state signal
- `text-text-tertiary` (idle/disabled) → `text-accent` (enabled)
- `disabled:cursor-default`

### New Chat Button

```tsx
<button
  className="flex items-center gap-1.5 text-xs text-text-tertiary
             hover:text-text-secondary disabled:opacity-40
             transition-colors duration-150
             px-2 py-1.5 rounded-lg hover:bg-surface-subtle"
>
  <SquarePen className="w-3.5 h-3.5" />
  New chat
</button>
```

### Message Bubbles

**User messages**
```tsx
<div className="px-4 py-3 rounded-2xl bg-accent text-white">
  <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
</div>
// Alignment: justify-end, max-w-[75%] items-end
```

**Assistant messages**
```tsx
// No bubble — prose rendered directly on the canvas
<div className="text-text-primary prose-chat">
  <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
</div>
// Alignment: justify-start, max-w-[90%] items-start
```

**Markdown component defaults (prose-chat)**
| Tag | Classes |
| --- | --- |
| `p` | `text-sm leading-relaxed mb-2 last:mb-0` |
| `ul` / `ol` | `text-sm list-disc/decimal pl-5 mb-2 space-y-1` |
| `li` | `leading-relaxed` |
| `h1` | `text-lg font-semibold mb-2` |
| `h2` | `text-base font-semibold mb-2` |
| `h3` | `text-sm font-semibold mb-1` |
| `code` | `text-xs bg-surface-subtle px-1.5 py-0.5 rounded-sm border border-stroke-subtle` |
| `pre` | `text-xs bg-surface-subtle p-3 border border-stroke-subtle overflow-x-auto mb-2` |
| `a` | `text-accent hover:text-accent-anchor hover:underline` |
| `blockquote` | `border-l border-divider pl-3 text-text-secondary mb-2` |

### Session History Rows

```tsx
<div className="group flex items-center gap-3 px-3 py-2.5
                rounded-xl hover:bg-surface-subtle
                transition-colors duration-100 cursor-pointer">
  <MessageSquare className="w-4 h-4 text-text-tertiary shrink-0" />
  <span className="flex-1 text-sm text-text-secondary truncate">{title}</span>
  <span className="text-xs text-text-tertiary shrink-0 tabular-nums">{relativeTime}</span>
  <button className="shrink-0 p-0.5 rounded transition-all duration-100
                     text-text-tertiary hover:text-red-400
                     opacity-0 group-hover:opacity-100">
    <Trash2 className="w-3.5 h-3.5" />
  </button>
</div>
```

### Primary Button (`btn-primary`)

Defined as a global CSS class — do not replicate inline.

```css
.btn-primary {
  @apply inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[20px];
  @apply border border-accent text-accent bg-surface font-medium text-sm;
  /* Opacity-fade fill on hover (accent bg), lift + compress motion */
}
```

- `rounded-[20px]` — slightly softer than data surfaces
- Uses `bg-surface` (not `bg-white`) so it adapts correctly in all contexts
- Hover: accent fill fades in (no shadow, no lift)
- Active: `scale(0.98)` (100ms)
- Disabled: `opacity-50 cursor-not-allowed`

### Small Action Chip Button

Used for compact toolbar/header actions (e.g. Upload, Sync Drive, Import from Drive). Matches the visual weight of a selected toggle tab — white surface, subtle shadow lift.

```tsx
<button
  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary
             bg-surface-subtle ring-1 ring-inset ring-black/[0.08]
             enabled:hover:bg-black/[0.07]
             disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
  <Icon className="w-3.5 h-3.5" />
  Label
</button>
```

**Rules**
- `bg-surface-subtle` — off-white fill that contrasts with the white workspace container
- `ring-1 ring-inset ring-black/[0.08]` — hairline inset border gives a clear button edge on white backgrounds without using shadow
- `hover:bg-black/[0.07]` — slightly darker fill on hover
- `text-text-secondary` — never tertiary; the button must be clearly legible
- `px-2.5 py-1.5 rounded-md` — compact, not pill-shaped (reserved for `btn-primary`)
- Use this pattern for all small action buttons in toolbar rows that sit on a white (`bg-surface`) container
- Do **not** use `bg-white shadow-sm` — shadow blends into the white workspace; Do **not** use `bg-black/[0.04]` alone — reads as disabled/inactive without the ring

---

### Secondary Button (`btn-secondary`)

Defined as a global CSS class — do not replicate inline. Used for cancel/dismiss actions alongside a primary CTA.

```css
.btn-secondary {
  @apply inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[20px];
  @apply bg-surface text-text-primary font-medium border border-stroke-subtle text-sm;
  /* Same shape as btn-primary; hover fills with surface-subtle */
}
```

- `rounded-[20px]` — identical radius to `btn-primary`; both buttons in a pair must always match in shape
- Hover: `surface-subtle` fill fades in (no accent color)
- Active: `scale(0.98)` (100ms)
- Disabled: `opacity-50 cursor-not-allowed`

### Widget Footer Action Bar

Widget cards (alignment, plan structure, etc.) use a compact footer to confirm or trigger generation. The footer is always a horizontal flex row with a hint label on the left and a compact `btn-primary` on the right — never a full-width button.

```tsx
<div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
  <p className="text-[10px] text-text-tertiary">
    Hint text here &middot; Secondary hint
  </p>
  <button
    onClick={handleConfirm}
    disabled={isLoading}
    className="btn-primary !text-xs !px-4 !py-1.5"
  >
    {isLoading ? (
      <>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading...
      </>
    ) : (
      <>
        <Check className="w-3.5 h-3.5" />
        Confirm &amp; Generate
      </>
    )}
  </button>
</div>
```

**Rules**
- Footer padding: `px-5 py-3` — never `py-4`
- Button override: `!text-xs !px-4 !py-1.5` — reduces the base `btn-primary` size for widget context
- Icon size inside compact button: `w-3.5 h-3.5`
- Hint text: `text-[10px] text-text-tertiary`, `&middot;` as separator between hints
- Never use `w-full` on a widget footer action button — the right-aligned compact form is canonical

### Workflow Step Card Primary Action

Any card or tile that drives a workflow step (framework selection, scope confirmation, analysis run) places its primary CTA in a footer bar — never as a standalone block element inside the card body.

```tsx
{/* Workflow step card */}
<div className="border border-accent/30 bg-accent-wash/30 rounded-lg overflow-hidden">
  <div className="px-5 py-4 space-y-3">
    {/* Card body content */}
  </div>
  {/* Footer action bar */}
  <div className="px-5 py-3 bg-surface-subtle/50 border-t border-accent/20 flex items-center justify-between">
    <p className="text-[10px] text-text-tertiary">Hint text here</p>
    <button onClick={handleAction} className="btn-primary !text-xs !px-4 !py-1.5">
      Continue with ...
    </button>
  </div>
</div>
```

**Rules**
- Use `btn-primary !text-xs !px-4 !py-1.5` — same compact override as widget footer
- Always pair with hint text on the left (`text-[10px] text-text-tertiary`)
- Footer background: `bg-surface-subtle/50` with `border-t border-accent/20` on accent-tinted cards, or `border-t border-divider` on neutral cards
- Never float or center the CTA — always `justify-between` footer row

### Framework / Alternative Tiles

Tiles in framework selection (or similar classification UIs) use a tag in the top-right and a compact action button in the footer.

```tsx
<div className="border border-divider rounded-lg overflow-hidden">
  <div className="px-4 py-3">
    {/* Name + tag in the same row */}
    <div className="flex items-start justify-between gap-3 mb-1">
      <span className="text-sm font-medium text-text-secondary">{name}</span>
      {/* Tag: same pattern as REQ/confidence tags */}
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">
        Possibly relevant
      </span>
    </div>
    <p className="text-[11px] text-text-tertiary leading-relaxed">{reason}</p>
  </div>
  {/* Action in footer, bottom-right */}
  <div className="px-4 py-2 border-t border-divider flex justify-end">
    <button className="btn-primary !text-xs !px-3 !py-1">
      Use instead
    </button>
  </div>
</div>
```

**Tag color conventions for framework tiles**
| State | Classes |
| --- | --- |
| Possibly relevant | `bg-amber-50 text-amber-700` |
| Likely not relevant | `bg-gray-100 text-gray-500` |
| Recommended | `bg-accent/10 text-accent` |

### Scope-Fact Review Tiles

Used in any workflow step where the user confirms pre-filled facts before running an analysis. Mirrors the `TemplateRequirementsWidget` tile pattern.

```tsx
{/* Tile — amber tint when pending, white when confirmed */}
<div className={`rounded-lg border transition-colors ${
  fact.confirmed ? 'border-stroke-subtle bg-white' : 'border-amber-200 bg-amber-50/40'
}`}>
  {/* Header: label + status badge */}
  <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1.5">
    <span className="text-xs font-medium text-text-primary">{fact.label}</span>
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-1 shrink-0 ${bg} ${text}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  </div>
  {/* Input area */}
  <div className="px-4 pb-3">
    {/* Yes/No toggle (preferred for binary facts) */}
    <div className="flex items-center gap-1.5 mt-0.5">
      {['Yes', 'No'].map((opt) => (
        <button key={opt} type="button"
          className={`text-[11px] font-medium px-3 py-1 rounded-md border transition-colors ${
            isSelected ? 'bg-surface-subtle border-stroke-muted text-text-primary'
                       : 'border-stroke-subtle text-text-secondary hover:border-stroke-muted'
          }`}
        >{opt}</button>
      ))}
    </div>
  </div>
</div>
```

**Status badge palette for scope facts**
| State | Classes |
| --- | --- |
| Confirmed (user-set) | `bg-green-50 text-green-700` + `CheckCircle2` |
| Auto-detected | `bg-green-50 text-green-700` + `CheckCircle2` |
| Needs input | `bg-amber-50 text-amber-700` + `HelpCircle` |

**Field type rules**
- Binary facts (yes/no involvement, presence, intent) → **Yes / No toggle buttons** (auto-confirm on click)
- Categorical facts with a bounded option set → **`<select>`** (auto-confirm on change)
- Open-ended text → **`<input type="text">`** + explicit Confirm button
- Never render LLM source tags (`"auto"`, `"needs_confirmation"`) as field values — sanitize to empty string before display

**Footer**
Always use the Widget Footer Action Bar pattern: hint text on left (count of pending facts), `btn-primary !text-xs !px-4 !py-1.5` on right. Disable the button until all facts are confirmed.

---

## M) Loading States

### Page-Level: `PageLoader` (Sprout ↔ TreeDeciduous)

Use for full-page or full-panel loading states — anywhere a user is waiting for a significant operation to complete (data fetch, LLM analysis, file processing).

```tsx
import { PageLoader } from '@/components/ui/PageLoader';

// Default label
<PageLoader />

// Custom label
<PageLoader label="Analyzing project…" />
```

The component cross-fades between `Sprout` and `TreeDeciduous` (Lucide) at 750ms intervals with an opacity + scale transition, matching the workspace page-load overlay.

**Rules**
- Use `PageLoader` for page-level, panel-level, or stage-level waits (routing, running analysis, loading a project)
- Never use `PageLoader` for inline or sub-component loading (thought chains, button spinners, row-level status) — use `Loader2 className="animate-spin"` there
- Wrap in a centered flex container: `<div className="flex items-center justify-center pt-16"><PageLoader label="…" /></div>`
- Label should end with `…` (ellipsis), not a period

### Inline: `Loader2` (Spinner)

Use for button loading states, thought chains, and any sub-component spinner.

```tsx
import { Loader2 } from 'lucide-react';

<Loader2 className="w-3.5 h-3.5 animate-spin" />
```

---

## N) Accessibility (Visual)
- WCAG AA contrast minimum
- Color never sole indicator
- Focus and selection clearly visible

---

## O) Visual North Star

The UI should feel at home next to native macOS productivity apps, enterprise desktop tools, and high-end analytics platforms.

The outer shell is a quiet, soft warm-grey frame. The workspace inside is clean white — distinct, elevated, and clearly the working area. Cards inside the workspace are soft surfaces with shadow edges, not wireframe rectangles.

If it feels like a browser-first admin template, it is off-spec.  
If blue is prominent in the chrome or structure, it is off-spec.  
If borders are doing structural work that shadows could do, it is off-spec.

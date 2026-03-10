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
| `ShellBackground` | `#FAF8F5` | App outer background, page body |
| `ShellBar` | `#FDFCFA` | Top bar and nav rail fill |
| `ShellSubtle` | `#F0EDE8` | Shell-level hover, secondary grouping |

### Content Surfaces
| Token | Hex | Usage |
| --- | --- | --- |
| `SurfacePrimary` | `#FFFFFF` | Main workspace container, cards, panels |
| `SurfaceSubtle` | `#F7F5F2` | Forms, secondary panels, table rows |

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
| `AccentSecondaryAnchor` | `#4a3812` | Strong secondary emphasis |
| `AccentSecondary` | `#6e5a1a` | Secondary highlights |
| `AccentSecondaryTint` | `#9a8a5a` | Secondary hover fills |
| `AccentSecondaryWash` | `#e8e4cf` | Secondary subtle highlight |

### Semantic Indicators
| Token | Hex | Usage |
| --- | --- | --- |
| `IndicatorOrange` | `#B97A5D` | Warning |
| `IndicatorYellow` | `#C6B875` | Pending |
| `IndicatorGreen` | `#9DAA9B` | Success |

### Strokes & Dividers
| Token | Hex | Usage |
| --- | --- | --- |
| `Divider` | `#E0DCD6` | Structural separators (warm neutral) |
| `StrokeSubtle` | `#DDD9D3` | Input borders, subtle separators |
| `StrokeAccent` | `#005e72` | Focus / selected border (interactive only) |

**Rules**
- Default UI reads neutral — warm greys and off-whites
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

## E) Shell + Workspace Layout Model

The application is structured as two distinct visual layers:

### Layer 1: Shell (outer chrome)
- Background: `ShellBackground` (`#FAF8F5`)
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
| Primary / secondary buttons (`btn-primary`) | 20px | `rounded-[20px]` |
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

## K) Motion & Interaction Feedback (Web-Equivalent Haptics)

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

### Shadow Lift with Press Compression

For primary interactive elements, combine hover lift with press compression.

```css
.element {
  transition: box-shadow 200ms ease-out, transform 200ms ease-out;
}

.element:hover {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.element:active {
  box-shadow: none;
  transform: translateY(0) scale(0.98);
  transition: box-shadow 100ms ease-out, transform 100ms ease-out;
}
```

**Rules**
- Hover: lift up (-2px) with shadow fade in (200ms)
- Press: compress (scale 0.98), return to origin, shadow fades out (100ms)
- Active transition is faster than hover for snappier tactile feel
- Scale only 1–2%
- Never combine with bounce or elastic motion

**Apply to**
- Primary action buttons
- Secondary buttons with shadow
- Clickable cards

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
- Chat panel in split project view
- Inspector / deep-dive panel in project plan view

**Do not apply to**
- Modals or overlays (use opacity/scale instead)
- Inline content that reflows (use height animation or `display: none`)

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
- Hover: accent fill fades in, button lifts `translateY(-2px)` with shadow
- Active: `scale(0.98)`, shadow collapses (100ms)
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

---

## M) Accessibility (Visual)
- WCAG AA contrast minimum
- Color never sole indicator
- Focus and selection clearly visible

---

## N) Visual North Star

The UI should feel at home next to native macOS productivity apps, enterprise desktop tools, and high-end analytics platforms.

The outer shell is a quiet, warm off-white frame. The workspace inside is clean white — distinct, elevated, and clearly the working area. Cards inside the workspace are soft surfaces with shadow edges, not wireframe rectangles.

If it feels like a browser-first admin template, it is off-spec.  
If blue is prominent in the chrome or structure, it is off-spec.  
If borders are doing structural work that shadows could do, it is off-spec.

# Nitrogen UI Style Guide  
**Enterprise Visual System (Aesthetic-Only)**

This guide defines the visual language for Nitrogen as an enterprise-grade B2B platform.  
It is prescriptive and concise, prioritizing clarity, restraint, and long-term credibility.

## A) Design Principles

- **Calm, institutional, and precise**
- **White-first canvas**
- **Typography-led hierarchy**
- **Restrained geometry**
- **Minimal depth**
- **Color used primarily as meaning**
- **Interaction feedback through subtle motion (web-equivalent haptics)**

**Do**
- Keep layouts predictable and grid-aligned  
- Use neutral surfaces by default  
- Apply accent colors deliberately  
- Use micro-interactions to confirm intent  

**Don’t**
- Use large expressive color fills  
- Introduce playful shapes or motion  
- Mix multiple visual metaphors  
- Allow interactions to feel inert or abrupt  

## B) Color System (Hex Tokens)

### Core surfaces
| Token | Hex | Usage |
| --- | --- | --- |
| `BackgroundPrimary` | `#F5F5F7` | App background |
| `BackgroundTinted` | `#E8E3DB` | Secondary grouping background |
| `SurfacePrimary` | `#FAFAFA` | Cards / panels |
| `SurfaceSubtle` | `#EEEEEF` | Forms / secondary panels |

### Text
| Token | Hex | Usage |
| --- | --- | --- |
| `TextPrimary` | `#1C1C1E` | Primary text |
| `TextSecondary` | `#5A5A60` | Metadata |
| `TextTertiary` | `#7A7A82` | Helper text |

### Primary accent (use sparingly)
| Token | Hex | Usage |
| --- | --- | --- |
| `AccentAnchor` | `#121f4a` | Rare strong emphasis |
| `AccentPrimary` | `#1a2f6e` | Borders, focus, selection, links |
| `AccentTint` | `#5a699a` | Hover / pressed fills |
| `AccentWash` | `#cfd4e8` | Subtle highlight |

### Secondary accent
| Token | Hex | Usage |
| --- | --- | --- |
| `AccentSecondaryAnchor` | `#4a3812` | Strong secondary emphasis |
| `AccentSecondary` | `#6e5a1a` | Secondary borders, highlights, CTAs |
| `AccentSecondaryTint` | `#9a8a5a` | Secondary hover / pressed fills |
| `AccentSecondaryWash` | `#e8e4cf` | Secondary subtle highlight |

### Semantic indicators
| Token | Hex | Usage |
| --- | --- | --- |
| `IndicatorOrange` | `#B97A5D` | Warning |
| `IndicatorYellow` | `#C6B875` | Pending |
| `IndicatorGreen` | `#9DAA9B` | Success |

### Strokes & dividers
| Token | Hex | Usage |
| --- | --- | --- |
| `Divider` | `#DADADF` | Separators |
| `StrokeSubtle` | `#D5D5DB` | Borders |
| `StrokeAccent` | `#1a2f6e` | Focus / selected border |

**Rules**
- Default UI should read neutral  
- Accent is not a background color  
- Indicator colors encode meaning only  

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

## D) Spacing & Layout

### Spacing scale
`8, 12, 16, 20, 24, 32`

### Conventions
- Horizontal padding: **16–24**  
- Section spacing: **16–24**  
- Card padding: **16–20**  
- Dense stacks: **8–12**

## E) Shape & Corner Radius

### Default: Sharp Edges
**Most UI elements use no border radius (0px) for a precise, architectural feel:**
- Cards & panels
- Badges & status indicators
- Data tables & list items
- Navigation elements

### Exceptions by Context

| Element | Radius | Token |
| --- | --- | --- |
| Icon-only action buttons (edit, delete, close) | 4–6px | `rounded-sm` / `rounded` |
| Interactive pill tags (selection, toggle) | 4–6px | `rounded` |
| Ghost row hovers (history items, nav rows) | 8–12px | `rounded-lg` / `rounded-xl` |
| Primary / secondary buttons (`btn-primary`) | 20px | `rounded-[20px]` |
| Search inputs | 20px | `rounded-[20px]` |
| Chat composer textarea | 28px | `rounded-[28px]` |
| Message bubbles (user) | 16px | `rounded-2xl` |

**Rules**
- Default to **0** (sharp corners) for containers, cards, and data surfaces
- Chat and messaging surfaces use **pill-style rounding** (20–28px) for a conversational feel — this is the approved exception to the sharp-edge default
- Never exceed **28px** anywhere in the UI
- Consistent application within a surface: all inputs on the same page should share a radius tier

## F) Elevation & Depth

- Flat by default  
- Shadows only if separation is unclear or to indicate interactivity
- Low opacity, tight radius  
- No glass or blur on core content

## G) Icons & Imagery

### Icons
- **System**: Lucide React (monochromatic, 16–24px stroke)
- **Color**: Inherit from context or use accent colors
- **Usage**: Functional only — enhance meaning, don't decorate
- **No emojis**: Never use emoji in production UI

### Imagery
- Informational imagery only  
- Match image corners to container (8px standard)
- No decorative illustrations  

## H) Motion & Interaction Feedback (Web-Equivalent Haptics)

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

Use for
	•	Buttons (primary, secondary, ghost)
	•	Selectable rows or list items
	•	Interactive cards
	•	Pills and toggle-style controls

**Shadow Lift with Press Compression**

For primary interactive elements, combine hover lift with press compression. Shadow fades in on hover and fades out on press for tactile feedback.

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

### 3D Depth Effect (Marketing Pages Only)

For marketing/landing pages and promotional materials, use a bolder 3D depth effect that creates a "raised button" appearance. This style is more expressive and should **not** be used in the core application UI.

**Behavior**
- **Default**: Flat, no shadow (2D appearance)
- **Hover**: Button lifts up-left, revealing solid 3D depth shadow
- **Press**: Button compresses back to origin, shadow disappears

```css
/* Marketing button - 3D depth on hover */
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

**Shadow Color Rules**
- If button fills with accent color on hover: use light grey (`StrokeSubtle` / `#D5D5DB`)
- If button stays neutral/white on hover: use accent color (`AccentPrimary` / `#1a2f6e`)

**Apply to (marketing only)**
- Hero CTAs on landing pages
- Promotional banners
- Marketing page buttons
- Not-yet-built home page elements

**Do not apply to**
- Core application UI (project pages, editors, forms)
- Dense UI with multiple buttons
- Navigation elements
- Any in-app workflows

---

**Deliberate Micro-Delay**

For high-importance actions, a 30–60ms delay before state change is acceptable to add perceived weight.

## I) Chat & Messaging Patterns

These are the approved patterns for all chat and compliance-chat surfaces. Follow them exactly.

### Chat Composer (Textarea Input)

```tsx
// Pill-shaped, auto-resize, hidden scrollbar
<textarea
  className="w-full resize-none rounded-[28px] border border-stroke-subtle bg-white
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
- Auto-resize capped at `150px` (`Math.min(textarea.scrollHeight, 150)`)
- Placeholder clears when the textarea is focused (`focused ? '' : placeholder`)
- Hidden scrollbar via inline style (Tailwind cannot suppress it cross-browser)

### Send Button

```tsx
// Inline icon-only, positioned absolute right-3, vertically centered
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
- `disabled:cursor-default` (not `not-allowed`) so the empty-input state feels natural

### New Chat Button

```tsx
// Ghost text button, top-right of conversation panel
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

**Rules**
- `SquarePen` icon (Lucide) — never a `Plus` or `RefreshCw`
- Ghost pattern: no background at rest, `surface-subtle` fill on hover
- `text-xs` — kept lightweight to not compete with message content

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
  <ReactMarkdown components={markdownComponents}>
    {content}
  </ReactMarkdown>
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
  {/* Delete — visible on hover only */}
  <button className="shrink-0 p-0.5 rounded transition-all duration-100
                     text-text-tertiary hover:text-red-400
                     opacity-0 group-hover:opacity-100">
    <Trash2 className="w-3.5 h-3.5" />
  </button>
</div>
```

**Rules**
- Delete icon hidden at rest (`opacity-0`), revealed on row hover via Tailwind `group-hover`
- `tabular-nums` on relative timestamps to prevent layout shift
- Section label above the list: `text-xs font-medium text-text-tertiary uppercase tracking-wider`

### Primary Button (`btn-primary`)

Defined as a global CSS class — do not replicate inline.

```css
.btn-primary {
  @apply inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[20px];
  @apply border border-accent text-accent bg-white font-medium text-sm;
  /* Opacity-fade fill on hover (accent bg), lift + compress motion */
}
```

- `rounded-[20px]` — slightly softer than data surfaces, appropriate for action buttons
- Hover: accent fill fades in (`opacity 200ms`), button lifts `translateY(-2px)` with `shadow-md`
- Active: `scale(0.98)`, shadow collapses (`100ms`)
- Disabled: `opacity-50 cursor-not-allowed`
- Leading icon size: `w-4 h-4`; use `Loader2 animate-spin` during loading state

---

## J) Accessibility (Visual)
- WCAG AA contrast minimum
- Color never sole indicator
- Focus and selection clearly visible

## K) Visual North Star

The UI should feel at home next to enterprise dashboards, analytics tools, and compliance software.
If it feels playful or brand-forward, it is likely off-spec.
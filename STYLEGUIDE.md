# Wisterion UI Style Guide  
**Enterprise Visual System (Aesthetic-Only)**

This guide defines the visual language for Wisterion as an enterprise-grade B2B platform.  
It is prescriptive and concise, prioritizing clarity, restraint, and long-term credibility.

---

## A) Design Principles

- **Calm, institutional, and precise**
- **White-first canvas**
- **Typography-led hierarchy**
- **Restrained geometry**
- **Minimal depth**
- **Color used primarily as meaning**

**Do**
- Keep layouts predictable and grid-aligned  
- Use neutral surfaces by default  
- Apply accent colors deliberately  

**Don’t**
- Use large expressive color fills  
- Introduce playful shapes or motion  
- Mix multiple visual metaphors  

---

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
| `AccentAnchor` | `#2E2749` | Rare strong emphasis |
| `AccentPrimary` | `#3E355F` | Borders, focus, selection, links |
| `AccentTint` | `#7B739D` | Hover / pressed fills |
| `AccentWash` | `#D5D2E8` | Subtle highlight |

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
| `StrokeAccent` | `#3E355F` | Focus / selected border |

**Rules**
- Default UI should read neutral  
- Accent is not a background color  
- Indicator colors encode meaning only  

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

## E) Shape & Corner Radius

### Default: Sharp Edges
**Most UI elements use no border radius (0px) for a precise, architectural feel:**
- Cards & panels
- Buttons (primary, secondary, ghost)
- Input fields & text areas
- Badges & status indicators
- Data tables & list items
- Navigation elements

### Exceptions: Subtle Rounding for Interactive Elements
**Small radius (4-6px) reserved for:**
- Icon-only buttons (edit, delete, close actions)
- Interactive pill buttons (input/output selection tags)
- Action icons that need tactile affordance
- Upload zones with rounded borders

### Why Sharp?
- Creates clean grid alignment
- Enhances institutional, precise aesthetic
- Maintains consistency with data-heavy interfaces
- Better suits Watershed-inspired hard accent lines

**Rules**
- Default to **0** (sharp corners) for all containers and buttons
- Use **4-6px** only for small interactive elements that benefit from softness
- Never use radius > **8px** anywhere in the UI
- Consistent application: if one button is sharp, all similar buttons are sharp  

---

## F) Elevation & Depth

- Flat by default  
- Shadows only if separation is unclear  
- Low opacity, tight radius  
- No glass or blur on core content  

---

## G) Icons & Imagery

### Icons
- **System**: Lucide React (monochromatic, 16-24px stroke)
- **Color**: Inherit from context or use accent colors
- **Usage**: Functional only — enhance meaning, don't decorate
- **No emojis**: Never use emoji in production UI

**Icon color patterns**
- Default state: `text-text-secondary` (neutral)
- Active/selected: `text-accent` (primary accent)
- Status indicators: `text-indicator-*` (semantic meaning)

**Do**
```tsx
<FileText className="w-5 h-5 text-accent" />
<CheckCircle className="w-4 h-4 text-indicator-green" />
```

**Don't**
```tsx
<span>📄</span> // No emojis
<Icon className="w-12 h-12" /> // Too large
<Icon color="#FF5733" /> // Custom colors outside system
```

### Imagery
- Informational imagery only  
- Match image corners to container (8px standard)
- No decorative illustrations  

---

## H) Motion & Transitions

### Timing
- **Default duration**: 200ms for hover states
- **Easing**: `ease-in-out` for smooth fade effects
- No expressive or elastic easing

### Opacity Fade Pattern (Preferred)
For button and interactive element hover states, use **opacity-based transitions** via pseudo-elements. This creates a smooth, professional fade-in/fade-out effect rather than an abrupt color swap.

**Implementation:**
```css
.element {
  position: relative;
  overflow: hidden;
  z-index: 0;
}

.element::before {
  content: '';
  position: absolute;
  inset: 0;
  background-color: var(--target-color);
  opacity: 0;
  transition: opacity 200ms ease-in-out;
  z-index: -1;
}

.element:hover::before {
  opacity: 1;
}
```

**Available CSS classes:**

*Buttons:*
- `.btn-primary` — Accent border/text, fills with accent on hover
- `.btn-secondary` — Subtle border, fills with surface-subtle on hover
- `.btn-ghost` — No border, fills with surface-subtle on hover
- `.btn-filled` — For filled buttons that darken on hover (e.g., send button)
- `.upload-btn` — Dashed border upload/action button

*Interactive Elements:*
- `.selectable-item` — For checkbox/toggle style items (add `.selected` when active)
- `.checkbox-indicator` — Checkbox square with fade (add `.checked` when active)
- `.pill-btn` — Pill/tag buttons (add `.selected` when active)
- `.icon-btn` — Icon-only buttons (variants: `.icon-btn-danger`, `.icon-btn-success`)
- `.expandable-header` — Collapsible section headers
- `.card-interactive` — Clickable cards with hover effect

*Generic Utilities:*
- `.hover-fade` — Generic utility for surface-subtle hover fade
- `.hover-fade-accent` — Generic utility for accent-wash hover fade

**Rules**
- Use opacity fade for all buttons (primary, secondary, ghost)
- Use opacity fade for significant interactive elements
- Simple icon buttons can use standard `transition-colors` for subtle states
- Keep transitions short and purposeful — no decorative motion

---

## I) Accessibility (Visual)

- WCAG AA contrast minimum  
- Color never sole indicator  
- Focus and selection clearly visible  

---

## J) Visual North Star

The UI should feel at home next to enterprise dashboards, analytics tools, and compliance software.  
If it feels playful or brand-forward, it is likely off-spec.
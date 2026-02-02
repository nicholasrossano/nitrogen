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
- Buttons (primary, secondary, ghost)
- Input fields & text areas
- Badges & status indicators
- Data tables & list items
- Navigation elements

### Exceptions: Subtle Rounding for Interactive Elements
**Small radius (4–6px) reserved for:**
- Icon-only buttons (edit, delete, close actions)
- Interactive pill buttons (input/output selection tags)
- Action icons that need tactile affordance
- Upload zones with rounded borders

**Rules**
- Default to **0** (sharp corners) for all containers and buttons
- Use **4–6px** only for small interactive elements that benefit from softness
- Never use radius > **8px** anywhere in the UI
- Consistent application: if one button is sharp, all similar buttons are sharp  

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

## I) Accessibility (Visual)
	•	WCAG AA contrast minimum
	•	Color never sole indicator
	•	Focus and selection clearly visible

## J) Visual North Star

The UI should feel at home next to enterprise dashboards, analytics tools, and compliance software.
If it feels playful or brand-forward, it is likely off-spec.
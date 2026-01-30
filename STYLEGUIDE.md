# Nitrogen UI Style Guide (Updated — Inter + New Palette)

This guide codifies the current visual system and defines constraints so new UI stays consistent.

## A) Design Principles

- **Clean, modern, and enterprise-calm.** The UI should read as credible and "tool-like," prioritizing clarity over expressiveness.
- **White-first surfaces.** Primary backgrounds are white; tinted backgrounds are used sparingly for grouping or secondary areas.
- **Typography-led hierarchy.** Hierarchy is driven by type scale, weight, and spacing — not color or ornament.
- **Restrained color usage.** Color is primarily for indicators (status, category, state) and limited emphasis. Avoid large brand-color fills.
- **Soft-but-controlled geometry.** Rounded rectangles remain, but rounding is more restrained and consistent.
- **Minimal depth.** Prefer strokes and background contrast over shadows; use shadows only when separation is unclear.

### Do
- Use white as the default canvas and keep content legible and dense-friendly.
- Use the primary accent mostly for subtle borders, selection states, and focus rings.
- Use orange/yellow/green primarily as semantic indicators, not decoration.

### Don't
- Introduce high-saturation colors or gradients as core UI surfaces.
- Use large tinted sections unless they communicate grouping or hierarchy.
- Use multiple accent colors in the same component unless it's semantic (status).

---

## B) Color System (Hex Tokens)

All named colors below are the formal Nitrogen tokens. The palette is designed to be used sparingly, with most surfaces remaining neutral.

### Core surfaces

| Token | Hex (Light) | Hex (Dark) | Role / Usage Notes |
|-------|-------------|------------|-------------------|
| BackgroundPrimary | `#FFFFFF` | `#1C1C1E` | App background (white-first) |
| BackgroundTinted | `#EFEAE2` | `#2A2A2C` | Tinted page/group background (sparingly) |
| SurfacePrimary | `#FFFFFF` | `#1C1C1E` | Cards / panels |
| SurfaceSubtle | `#F7F7F8` | `#242426` | Subtle surface alt (forms, secondary panels) |

### Text

| Token | Hex (Light) | Hex (Dark) | Role / Usage Notes |
|-------|-------------|------------|-------------------|
| TextPrimary | `#1C1C1E` | `#FFFFFF` | Primary text |
| TextSecondary | `#5A5A60` | `#C7C7CC` | Secondary text / metadata |
| TextTertiary | `#7A7A82` | `#8E8E93` | Helper text / low-emphasis |

### Primary accent (use sparingly)

| Token | Hex (Light) | Hex (Dark) | Role / Usage Notes |
|-------|-------------|------------|-------------------|
| AccentAnchor | `#5F628F` | `#B2B4D6` | Strong accent for key emphasis (rare) |
| AccentPrimary | `#8285B6` | `#8285B6` | Core accent (borders, focus, selection, links) |
| AccentTint | `#B2B4D6` | `#B2B4D6` | Soft accent tint (hover/pressed backgrounds, subtle fills) |
| AccentWash | `#E6E7F2` | `#2D2F43` | Very light wash for selected rows / subtle highlight |

### Semantic indicators (primary use = meaning, not decoration)

| Token | Hex (Light) | Hex (Dark) | Role / Usage Notes |
|-------|-------------|------------|-------------------|
| IndicatorOrange | `#B97A5D` | `#B97A5D` | Warning / attention / "needs review" |
| IndicatorYellow | `#C6B875` | `#C6B875` | Caution / pending / "in progress" |
| IndicatorGreen | `#9DAA9B` | `#9DAA9B` | Success / ready / verified |

### Strokes & dividers

| Token | Hex (Light) | Hex (Dark) | Role / Usage Notes |
|-------|-------------|------------|-------------------|
| Divider | `#E6E6EA` | `#2C2C2E` | Dividers, separators |
| StrokeSubtle | `#E1E1E6` | `#2C2C2E` | Card borders / input borders |
| StrokeAccent | `#8285B6` | `#8285B6` | Accent border (sparingly; selection/focus) |

### Color usage rules
- **Default state**: neutral UI (white + subtle grays).
- **Accent** (`#8285B6`) is primarily for borders, focus rings, selection, and links — not big fills.
- **Orange/Yellow/Green** are for indicator chips, status dots, badges, and small highlights only.

---

## C) Typography (Inter + Space Grotesk)

### Fonts in use
- **Inter**: primary UI font for body, labels, controls, and most headers.
- **Space Grotesk**: stylistic display/header font for select headings (sans-serif, editorial feel).

If Space Grotesk isn't available in your current iOS font pipeline, the fallback stylistic option is SF Pro Display Semibold (system) — but keep one "display voice" and use it consistently.

### Type scale (mapped to existing usage)
- **Title / Display XL** (48–60, Inter): rare, status/celebratory only.
- **Title** (32, Inter Semibold): screen titles.
- **Section Headline** (20–24, Space Grotesk Semibold): select hero headers / standout sections.
- **Headline** (18–20, Inter Semibold): card headers, section titles.
- **Body** (16, Inter): main text, buttons.
- **Body Small** (14–15, Inter): metadata, pills.
- **Caption** (13–14, Inter): helper text, chips, table labels.
- **Footnote** (11–12, Inter Medium): tiny helper text.

### Usage guidance
- Use **Inter everywhere by default**.
- Use **Space Grotesk only** when a header needs a subtle "brand voice" (1–2 levels max).
- **Avoid mixing** Inter + Space Grotesk within dense tables/forms — keep those purely Inter.

---

## Implementation Notes

### Tailwind CSS Configuration

When implementing this system in Tailwind:

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        // Core surfaces
        'bg-primary': '#FFFFFF',
        'bg-tinted': '#EFEAE2',
        'surface-primary': '#FFFFFF',
        'surface-subtle': '#F7F7F8',
        
        // Text
        'text-primary': '#1C1C1E',
        'text-secondary': '#5A5A60',
        'text-tertiary': '#7A7A82',
        
        // Accent
        'accent-anchor': '#5F628F',
        'accent-primary': '#8285B6',
        'accent-tint': '#B2B4D6',
        'accent-wash': '#E6E7F2',
        
        // Indicators
        'indicator-orange': '#B97A5D',
        'indicator-yellow': '#C6B875',
        'indicator-green': '#9DAA9B',
        
        // Strokes
        'divider': '#E6E6EA',
        'stroke-subtle': '#E1E1E6',
        'stroke-accent': '#8285B6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
}
```

### Component Patterns

#### Cards
```tsx
// Use white backgrounds with subtle strokes
<div className="bg-surface-primary border border-stroke-subtle rounded-lg">
  {/* content */}
</div>
```

#### Status Indicators
```tsx
// Use semantic colors for badges/chips only
<span className="bg-indicator-green/10 text-indicator-green px-2 py-1 rounded text-sm">
  Verified
</span>
```

#### Focus States
```tsx
// Use accent for interactive elements
<button className="border-2 border-transparent focus:border-accent-primary focus:ring-2 focus:ring-accent-wash">
  Action
</button>
```
